"""Short references to library items, and finding them through a library list.

A library list (docs/DATABASE.md, "Library Join Tables") is read from either end: a parent's
children (a role's bullets) or a child's parents (the sections that list a role). Each helper
takes the list, the column to group by, and those ids, and returns the refs for each id.
"""

from typing import Any

from pydantic import BaseModel
from sqlalchemy import ColumnElement, select
from sqlalchemy.orm import Session

from app.models import BulletPoint, Experience, Project, Section


class SectionRef(BaseModel):
    id: int
    title: str


class ExperienceRef(BaseModel):
    experience_id: int
    role_title: str
    organization: str
    # Versions of a role can share a title and organization, so the dates tell them apart.
    dates: str | None


class ProjectRef(BaseModel):
    project_id: int
    project_title: str
    done_for: str | None


class BulletRef(BaseModel):
    bullet_id: int
    content: str


def _grouped[T: BaseModel](db: Session, link, key: str, key_ids: list[int], model,
                           ref: type[T], account_id: int | None,
                           order_by: ColumnElement[Any] | None = None) -> dict[int, list[T]]:
    """The refs reached through `link` for each id in key_ids, in list order by default.

    The ref's fields are read from the model's columns of the same names. `account_id`
    narrows them to the account's own rows, since built-in sections list every account's.
    """
    table = link.__table__
    target = model.__table__.primary_key.columns[0]
    columns = [model.__table__.c[name] for name in ref.model_fields]
    link_column = next(column for column in table.c if column.references(target))
    query = (select(table.c[key], *columns)
             .join(model, target == link_column)
             .where(table.c[key].in_(key_ids))
             .order_by(order_by if order_by is not None else table.c.position))
    if account_id is not None:
        query = query.where(model.account_id == account_id)
    found: dict[int, list[T]] = {key_id: [] for key_id in key_ids}
    for key_id, *values in db.execute(query):
        found[key_id].append(ref(**dict(zip(ref.model_fields, values, strict=True))))
    return found


def section_refs(db: Session, link, key: str, key_ids: list[int]) -> dict[int, list[SectionRef]]:
    """The sections that list each item, built-in ones first."""
    return _grouped(db, link, key, key_ids, Section, SectionRef, None, Section.id)


def experience_refs(db: Session, link, key: str, key_ids: list[int], account_id: int,
                    order_by: ColumnElement[Any] | None = None) -> dict[int, list[ExperienceRef]]:
    return _grouped(db, link, key, key_ids, Experience, ExperienceRef, account_id, order_by)


def project_refs(db: Session, link, key: str, key_ids: list[int], account_id: int,
                 order_by: ColumnElement[Any] | None = None) -> dict[int, list[ProjectRef]]:
    return _grouped(db, link, key, key_ids, Project, ProjectRef, account_id, order_by)


def bullet_refs(db: Session, link, key: str, key_ids: list[int],
                account_id: int) -> dict[int, list[BulletRef]]:
    return _grouped(db, link, key, key_ids, BulletPoint, BulletRef, account_id)
