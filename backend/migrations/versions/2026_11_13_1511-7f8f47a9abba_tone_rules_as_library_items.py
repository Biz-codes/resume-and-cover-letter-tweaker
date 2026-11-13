"""tone rules as library items

A tone rule stands alone (its own account_id and hidden) and each tone lists its rules in
tone_set_tone_rule, in order, so one rule can be in many tones (docs/DATABASE.md). The data
moves with it:
- each rule's account is its tone's, and each tone lists the rules it had, in the same order;
- the account holds each rule once, so rules with the same text (ignoring spacing and
  capitals) become one, the oldest, listed wherever any of them was;
- tone names are unique in an account, so a tone sharing an older tone's name is renamed
  "[name] (2)", "[name] (3)", and so on.

Downgrading gives each tone its own copy of a rule it shares, and drops rules no tone lists.

Revision ID: 7f8f47a9abba
Revises: e651ffa1cefb
Create Date: 2026-11-13 15:11:22.366916

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '7f8f47a9abba'
down_revision: str | Sequence[str] | None = 'e651ffa1cefb'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# How two rules' text is compared: ignoring spacing and capitals.
SAME_TEXT = "lower(regexp_replace(btrim({0}), '\\s+', ' ', 'g'))"


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('tone_set_tone_rule',
    sa.Column('tone_set_id', sa.Integer(), nullable=False),
    sa.Column('tone_rule_id', sa.Integer(), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['tone_rule_id'], ['tone_rule.tone_rule_id'], name=op.f('fk_tone_set_tone_rule_tone_rule_id_tone_rule'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tone_set_id'], ['tone_set.tone_set_id'], name=op.f('fk_tone_set_tone_rule_tone_set_id_tone_set'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('tone_set_id', 'tone_rule_id', name=op.f('pk_tone_set_tone_rule'))
    )
    op.add_column('tone_rule', sa.Column('account_id', sa.Integer(), nullable=True))
    op.add_column('tone_rule', sa.Column('hidden', sa.Boolean(), server_default=sa.text('FALSE'), nullable=False))
    op.execute("""
        UPDATE tone_rule r SET account_id = t.account_id
        FROM tone_set t WHERE t.tone_set_id = r.tone_set_id
    """)
    # Each tone's list, pointing at the oldest rule with the same text in the account.
    same = SAME_TEXT.format("r.rule_text")
    keep_same = SAME_TEXT.format("k.rule_text")
    op.execute(f"""
        INSERT INTO tone_set_tone_rule (tone_set_id, tone_rule_id, position)
        SELECT tone_set_id, kept, ROW_NUMBER() OVER (PARTITION BY tone_set_id ORDER BY first)
        FROM (
            SELECT r.tone_set_id,
                   (SELECT min(k.tone_rule_id) FROM tone_rule k
                    WHERE k.account_id = r.account_id AND {keep_same} = {same}) AS kept,
                   min(r.position * 1000000 + r.tone_rule_id) AS first
            FROM tone_rule r
            GROUP BY r.tone_set_id, kept
        ) listed
    """)
    op.execute(f"""
        DELETE FROM tone_rule r WHERE EXISTS (
            SELECT 1 FROM tone_rule k
            WHERE k.account_id = r.account_id AND {keep_same} = {same}
              AND k.tone_rule_id < r.tone_rule_id)
    """)
    # Tone names are unique in an account: later ones sharing a name get a number.
    op.execute("""
        UPDATE tone_set t SET name = t.name || ' (' || numbered.n || ')'
        FROM (
            SELECT tone_set_id, ROW_NUMBER() OVER (
                PARTITION BY account_id, lower(name) ORDER BY created_at, tone_set_id) AS n
            FROM tone_set
        ) numbered
        WHERE numbered.tone_set_id = t.tone_set_id AND numbered.n > 1
    """)
    op.alter_column('tone_rule', 'account_id', nullable=False)
    op.drop_constraint(op.f('fk_tone_rule_tone_set_id_tone_set'), 'tone_rule', type_='foreignkey')
    op.create_foreign_key(op.f('fk_tone_rule_account_id_account'), 'tone_rule', 'account', ['account_id'], ['account_id'], ondelete='CASCADE')
    op.drop_column('tone_rule', 'tone_set_id')
    op.drop_column('tone_rule', 'position')


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column('tone_rule', sa.Column('position', sa.INTEGER(), autoincrement=False, nullable=True))
    op.add_column('tone_rule', sa.Column('tone_set_id', sa.INTEGER(), autoincrement=False, nullable=True))
    # The first tone listing a rule keeps it; each other tone gets its own copy.
    op.execute("""
        UPDATE tone_rule r SET tone_set_id = first.tone_set_id, position = first.position
        FROM (
            SELECT DISTINCT ON (tone_rule_id) tone_rule_id, tone_set_id, position
            FROM tone_set_tone_rule ORDER BY tone_rule_id, tone_set_id
        ) first
        WHERE first.tone_rule_id = r.tone_rule_id
    """)
    op.execute("""
        INSERT INTO tone_rule (account_id, rule_text, tone_set_id, position)
        SELECT r.account_id, r.rule_text, l.tone_set_id, l.position
        FROM tone_set_tone_rule l JOIN tone_rule r ON r.tone_rule_id = l.tone_rule_id
        WHERE l.tone_set_id <> r.tone_set_id
    """)
    op.execute("DELETE FROM tone_rule WHERE tone_set_id IS NULL")
    op.alter_column('tone_rule', 'position', nullable=False)
    op.alter_column('tone_rule', 'tone_set_id', nullable=False)
    op.drop_constraint(op.f('fk_tone_rule_account_id_account'), 'tone_rule', type_='foreignkey')
    op.create_foreign_key(op.f('fk_tone_rule_tone_set_id_tone_set'), 'tone_rule', 'tone_set', ['tone_set_id'], ['tone_set_id'], ondelete='CASCADE')
    op.drop_column('tone_rule', 'hidden')
    op.drop_column('tone_rule', 'account_id')
    op.drop_table('tone_set_tone_rule')
