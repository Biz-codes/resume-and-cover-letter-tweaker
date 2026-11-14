"""built-in tones

Four built-in tones with fixed ids, shared by every account (no account_id), each listing
built-in rules (docs/DATABASE.md, tone_set and tone_rule). Like the built-in sections, they can't
be renamed, edited, hidden, or deleted, and triggers block it as a backstop; a built-in tone's
list of rules never changes either.

The data moves to make room:
- a tone already using one of the fixed ids gets a new id, with everything that points at it;
- tone names are unique counting the built-in ones, so an account's tone with a built-in name
  is renamed "[name] (mine)";
- the account holds each rule once, counting the built-in ones, so an account's rule with a
  built-in rule's text (ignoring spacing and capitals) becomes that built-in rule.

Revision ID: 367f0f8f9e49
Revises: 7f8f47a9abba
Create Date: 2026-11-13 21:41:20.602137

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '367f0f8f9e49'
down_revision: str | Sequence[str] | None = '7f8f47a9abba'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Maps to the BUILT_IN_PROTECTED error code (app/errors.py).
BUILT_IN_SQLSTATE = "RT001"

# Each built-in tone, by its fixed id (app/models.py), with its rules in order. Generic, for any
# job, and following docs/WRITING_RULES.md.
BUILT_IN_TONES = [
    (1, "Professional", [
        "Plain, direct sentences, one idea per sentence.",
        "Start each bullet with an action verb: past tense, or present tense for the current role.",
        "Include a number, scale, or result wherever the content supports one.",
        'Let results show strengths instead of adjectives like "strong" or "excellent".',
        "No slang, jokes, or exclamation points.",
        'In a cover letter, don\'t start most sentences with "I".',
    ]),
    (2, "Technical", [
        "Name the specific tools, languages, and frameworks, spelled the way the posting spells "
        "them.",
        "Say what was built or changed, then how, then the result.",
        "Prefer measurable results: speed, uptime, users, cost, time saved.",
        "Use standard technical terms without explaining them.",
        "Keep bullets to one line where possible.",
        'Avoid business abstractions ("drove value", "aligned stakeholders") unless that was the '
        "work.",
    ]),
    (3, "Friendly but formal", [
        "Warm, courteous, complete sentences. Contractions are fine, but not many.",
        "Show interest in the organization with a specific detail from the posting, not general "
        "praise.",
        "Mention who the work helped: teammates, customers, students.",
        "Close by inviting a conversation, without pressure.",
        "No slang or exclamation points.",
    ]),
    (4, "Casual", [
        "Conversational. Contractions are fine.",
        "Short sentences and everyday words.",
        "One personal detail about why the work matters to you is fine. Skip jokes.",
        "Every claim is still tied to something you did.",
        "At most one exclamation point in a cover letter, and none in a resume.",
    ]),
]
BUILT_IN_IDS = ", ".join(str(tone_id) for tone_id, _, _ in BUILT_IN_TONES)
SAME_TEXT = "lower(regexp_replace(btrim({0}), '\\s+', ' ', 'g'))"


def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column('tone_rule', 'account_id', existing_type=sa.INTEGER(), nullable=True)
    op.alter_column('tone_set', 'account_id', existing_type=sa.INTEGER(), nullable=True)
    bind = op.get_bind()

    # New ids start past the fixed ones (and past every tone already there).
    bind.execute(sa.text(
        "SELECT setval(pg_get_serial_sequence('tone_set', 'tone_set_id'), "
        f"GREATEST({len(BUILT_IN_TONES)}, (SELECT COALESCE(MAX(tone_set_id), 0) FROM tone_set)))"))
    # A tone using a fixed id moves to a new one: a copy with the new id, everything pointed at
    # it, then the original deleted.
    for (old_id,) in bind.execute(sa.text(
            f"SELECT tone_set_id FROM tone_set WHERE tone_set_id IN ({BUILT_IN_IDS})")).all():
        new_id = bind.execute(sa.text(
            "SELECT nextval(pg_get_serial_sequence('tone_set', 'tone_set_id'))")).scalar()
        params = {"old": old_id, "new": new_id}
        bind.execute(sa.text("""
            INSERT INTO tone_set (tone_set_id, account_id, name, hidden, created_at, updated_at)
            SELECT :new, account_id, name, hidden, created_at, updated_at
            FROM tone_set WHERE tone_set_id = :old"""), params)
        for table in ("resume", "cover_letter", "tone_set_tone_rule"):
            bind.execute(sa.text(
                f"UPDATE {table} SET tone_set_id = :new WHERE tone_set_id = :old"), params)
        bind.execute(sa.text("DELETE FROM tone_set WHERE tone_set_id = :old"), params)

    # An account's tone with a built-in name keeps going under another.
    names = [name for _, name, _ in BUILT_IN_TONES]
    bind.execute(sa.text("""
        UPDATE tone_set SET name = name || ' (mine)'
        WHERE account_id IS NOT NULL AND lower(name) = ANY(:names)"""),
        {"names": [name.lower() for name in names]})

    # The built-in tones and their rules.
    for tone_id, name, rules in BUILT_IN_TONES:
        bind.execute(sa.text(
            "INSERT INTO tone_set (tone_set_id, account_id, name) VALUES (:id, NULL, :name)"),
            {"id": tone_id, "name": name})
        for position, text in enumerate(rules, start=1):
            rule_id = bind.execute(sa.text(
                "INSERT INTO tone_rule (account_id, rule_text) VALUES (NULL, :text) "
                "RETURNING tone_rule_id"), {"text": text}).scalar()
            bind.execute(sa.text(
                "INSERT INTO tone_set_tone_rule (tone_set_id, tone_rule_id, position) "
                "VALUES (:tone, :rule, :position)"),
                {"tone": tone_id, "rule": rule_id, "position": position})
    bind.execute(sa.text(
        "SELECT setval(pg_get_serial_sequence('tone_set', 'tone_set_id'), "
        "(SELECT MAX(tone_set_id) FROM tone_set))"))

    # An account's rule with a built-in rule's text becomes the built-in one, wherever it's
    # listed (once per tone).
    same = SAME_TEXT.format("r.rule_text")
    built_in = SAME_TEXT.format("b.rule_text")
    matches = bind.execute(sa.text(f"""
        SELECT r.tone_rule_id, b.tone_rule_id FROM tone_rule r
        JOIN tone_rule b ON b.account_id IS NULL AND {built_in} = {same}
        WHERE r.account_id IS NOT NULL""")).all()
    for own, shared in matches:
        params = {"own": own, "shared": shared}
        bind.execute(sa.text("""
            UPDATE tone_set_tone_rule l SET tone_rule_id = :shared
            WHERE l.tone_rule_id = :own AND NOT EXISTS (
                SELECT 1 FROM tone_set_tone_rule o
                WHERE o.tone_set_id = l.tone_set_id AND o.tone_rule_id = :shared)"""), params)
        bind.execute(sa.text("DELETE FROM tone_rule WHERE tone_rule_id = :own"), params)

    # The backstop, after the built-in rows are in. The backend checks first.
    op.execute(f"""
        CREATE FUNCTION protect_built_in_tone_set() RETURNS trigger AS $$
        BEGIN
            IF OLD.account_id IS NOT NULL THEN
                RETURN COALESCE(NEW, OLD);
            END IF;
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION '"%" is built in and can''t be deleted.', OLD.name
                    USING ERRCODE = '{BUILT_IN_SQLSTATE}';
            END IF;
            IF NEW.tone_set_id <> OLD.tone_set_id OR NEW.name IS DISTINCT FROM OLD.name
                    OR NEW.hidden IS DISTINCT FROM OLD.hidden
                    OR NEW.account_id IS DISTINCT FROM OLD.account_id THEN
                RAISE EXCEPTION '"%" is built in and can''t be changed.', OLD.name
                    USING ERRCODE = '{BUILT_IN_SQLSTATE}';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    """)
    op.execute("""
        CREATE TRIGGER tone_set_protect_built_in BEFORE UPDATE OR DELETE ON tone_set
        FOR EACH ROW EXECUTE FUNCTION protect_built_in_tone_set()
    """)
    op.execute(f"""
        CREATE FUNCTION protect_built_in_tone_rule() RETURNS trigger AS $$
        BEGIN
            IF OLD.account_id IS NOT NULL THEN
                RETURN COALESCE(NEW, OLD);
            END IF;
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'A built-in tone rule can''t be deleted.'
                    USING ERRCODE = '{BUILT_IN_SQLSTATE}';
            END IF;
            IF NEW.tone_rule_id <> OLD.tone_rule_id
                    OR NEW.rule_text IS DISTINCT FROM OLD.rule_text
                    OR NEW.hidden IS DISTINCT FROM OLD.hidden
                    OR NEW.account_id IS DISTINCT FROM OLD.account_id THEN
                RAISE EXCEPTION 'A built-in tone rule can''t be changed.'
                    USING ERRCODE = '{BUILT_IN_SQLSTATE}';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    """)
    op.execute("""
        CREATE TRIGGER tone_rule_protect_built_in BEFORE UPDATE OR DELETE ON tone_rule
        FOR EACH ROW EXECUTE FUNCTION protect_built_in_tone_rule()
    """)
    op.execute(f"""
        CREATE FUNCTION protect_built_in_tone_list() RETURNS trigger AS $$
        BEGIN
            IF (TG_OP <> 'INSERT' AND OLD.tone_set_id IN ({BUILT_IN_IDS}))
                    OR (TG_OP <> 'DELETE' AND NEW.tone_set_id IN ({BUILT_IN_IDS})) THEN
                RAISE EXCEPTION 'A built-in tone''s rules can''t be changed.'
                    USING ERRCODE = '{BUILT_IN_SQLSTATE}';
            END IF;
            RETURN COALESCE(NEW, OLD);
        END;
        $$ LANGUAGE plpgsql
    """)
    op.execute("""
        CREATE TRIGGER tone_set_tone_rule_protect_built_in
        BEFORE INSERT OR UPDATE OR DELETE ON tone_set_tone_rule
        FOR EACH ROW EXECUTE FUNCTION protect_built_in_tone_list()
    """)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP TRIGGER tone_set_tone_rule_protect_built_in ON tone_set_tone_rule")
    op.execute("DROP TRIGGER tone_rule_protect_built_in ON tone_rule")
    op.execute("DROP TRIGGER tone_set_protect_built_in ON tone_set")
    op.execute("DROP FUNCTION protect_built_in_tone_list()")
    op.execute("DROP FUNCTION protect_built_in_tone_rule()")
    op.execute("DROP FUNCTION protect_built_in_tone_set()")
    # Each account's tones that list a built-in rule get their own copy of it.
    op.execute("""
        INSERT INTO tone_rule (account_id, rule_text)
        SELECT DISTINCT t.account_id, r.rule_text
        FROM tone_set_tone_rule l
        JOIN tone_set t ON t.tone_set_id = l.tone_set_id AND t.account_id IS NOT NULL
        JOIN tone_rule r ON r.tone_rule_id = l.tone_rule_id AND r.account_id IS NULL
    """)
    op.execute("""
        UPDATE tone_set_tone_rule l SET tone_rule_id = own.tone_rule_id
        FROM tone_set t, tone_rule shared, tone_rule own
        WHERE t.tone_set_id = l.tone_set_id AND shared.tone_rule_id = l.tone_rule_id
          AND shared.account_id IS NULL AND own.account_id = t.account_id
          AND own.rule_text = shared.rule_text
    """)
    # Documents using a built-in tone go without one, as when a tone is deleted.
    op.execute(f"UPDATE resume SET tone_set_id = NULL WHERE tone_set_id IN ({BUILT_IN_IDS})")
    op.execute(f"UPDATE cover_letter SET tone_set_id = NULL WHERE tone_set_id IN ({BUILT_IN_IDS})")
    op.execute("DELETE FROM tone_set WHERE account_id IS NULL")
    op.execute("DELETE FROM tone_rule WHERE account_id IS NULL")
    op.alter_column('tone_set', 'account_id', existing_type=sa.INTEGER(), nullable=False)
    op.alter_column('tone_rule', 'account_id', existing_type=sa.INTEGER(), nullable=False)
