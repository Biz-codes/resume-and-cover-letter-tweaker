"""rename job_posting columns to role_title and organization

Revision ID: 6c835dd694f4
Revises: 41e4767c13db
Create Date: 2026-10-28 14:18:55.821511

"""
from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '6c835dd694f4'
down_revision: str | Sequence[str] | None = '41e4767c13db'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # Renamed in place so existing rows keep their values. Postings can be for internships
    # and other roles, so "organization" and "role title" fit better than "company" and "job".
    op.alter_column('job_posting', 'company', new_column_name='organization')
    op.alter_column('job_posting', 'job_title', new_column_name='role_title')


def downgrade() -> None:
    """Downgrade schema."""
    op.alter_column('job_posting', 'role_title', new_column_name='job_title')
    op.alter_column('job_posting', 'organization', new_column_name='company')
