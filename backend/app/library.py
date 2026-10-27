"""Shared rules for library items: unique names, ownership of linked ids, and ordered lists.

A library list is a join table where a parent lists its children with a `position`
(docs/DATABASE.md, "Library Join Tables"). Built-in parents (sections, "Other") are shared by
every account, so list queries are always narrowed to the current account's children.
"""

from collections.abc import Iterable
from typing import Any

from sqlalchemy import ColumnElement, delete, func, insert, or_, select, update
from sqlalchemy.orm import Session

from app.errors import AppError, ErrorCode


def check_unique_name(db: Session, column, account_id: int, name: str, label: str,
                      exclude: ColumnElement[bool] | None = None) -> None:
    """DUPLICATE if the account (or a built-in row) already has this name, ignoring capitals."""
    model = column.class_
    query = select(column).where(
        func.lower(column) == name.lower(),
        or_(model.account_id == account_id, model.account_id.is_(None)),
    )
    if exclude is not None:
        query = query.where(exclude)
    existing = db.scalar(query.limit(1))
    if existing is not None:
        raise AppError(ErrorCode.DUPLICATE, f'There\'s already a {label} named "{existing}".',
                       field=column.key)


def check_ids(db: Session, model, id_column, ids: Iterable[int], account_id: int,
              field: str, allow_built_in: bool = False) -> None:
    """Each id must be the account's own row (or a built-in one, when allowed)."""
    ids = list(ids)
    if len(set(ids)) != len(ids):
        raise AppError(ErrorCode.DUPLICATE, "The same item is in the list twice.", field=field)
    owners = dict(db.execute(select(id_column, model.account_id).where(id_column.in_(ids))).all())
    for item_id in ids:
        if item_id not in owners:
            raise AppError(ErrorCode.NOT_FOUND, field=field)
        owner = owners[item_id]
        if owner is None and not allow_built_in or owner not in (None, account_id):
            raise AppError(ErrorCode.CROSS_ACCOUNT_LINK, field=field)


def children(db: Session, link, parent_col: str, parent_id: int, child_col: str,
             visible: ColumnElement[bool] | None = None) -> list[int]:
    """The parent's children in order. `visible` narrows them to the account's own."""
    table = link.__table__
    query = select(table.c[child_col]).where(table.c[parent_col] == parent_id)
    if visible is not None:
        query = query.where(visible)
    return list(db.scalars(query.order_by(table.c.position)))


def append(db: Session, link, parent_col: str, parent_id: int, child_col: str,
           child_id: int) -> None:
    """List the child last under the parent, unless it's already listed."""
    table = link.__table__
    already = db.scalar(select(func.count()).select_from(table).where(
        table.c[parent_col] == parent_id, table.c[child_col] == child_id))
    if already:
        return
    last = db.scalar(select(func.max(table.c.position)).where(table.c[parent_col] == parent_id))
    db.execute(insert(table).values({parent_col: parent_id, child_col: child_id,
                                     "position": (last or 0) + 1}))


def set_children(db: Session, link, parent_col: str, parent_id: int, child_col: str,
                 child_ids: list[int], visible: Any = None) -> None:
    """Replace the parent's list with child_ids, in order.

    `visible` is a list of the account's child ids (a select): only those rows are replaced,
    so a built-in parent keeps other accounts' children.
    """
    table = link.__table__
    old = delete(table).where(table.c[parent_col] == parent_id)
    if visible is not None:
        old = old.where(table.c[child_col].in_(visible))
    db.execute(old)
    if child_ids:
        others = db.scalar(select(func.max(table.c.position))
                           .where(table.c[parent_col] == parent_id)) or 0
        db.execute(insert(table), [{parent_col: parent_id, child_col: child_id,
                                    "position": others + index}
                                   for index, child_id in enumerate(child_ids, start=1)])


def list_beside(db: Session, link, parent_col: str, child_col: str, old_id: int,
                new_id: int) -> None:
    """List new_id under every parent that lists old_id, right after it (for a new version)."""
    table = link.__table__
    listed = select(table.c[parent_col], table.c.position).where(table.c[child_col] == old_id)
    for parent_id, position in db.execute(listed).all():
        db.execute(update(table)
                   .where(table.c[parent_col] == parent_id, table.c.position > position)
                   .values(position=table.c.position + 1))
        db.execute(insert(table).values({parent_col: parent_id, child_col: new_id,
                                         "position": position + 1}))


def copy_children(db: Session, link, parent_col: str, old_id: int, new_id: int) -> None:
    """Give a new version of a parent the same list as the original, in the same order."""
    table = link.__table__
    columns = [column for column in table.c if column.name != parent_col]
    db.execute(insert(table).from_select(
        [parent_col, *(column.name for column in columns)],
        select(func.cast(new_id, table.c[parent_col].type), *columns)
        .where(table.c[parent_col] == old_id)))
