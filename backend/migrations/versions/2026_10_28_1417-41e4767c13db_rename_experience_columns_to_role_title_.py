"""rename experience columns to role_title and organization

Revision ID: 41e4767c13db
Revises: 230d2d621605
Create Date: 2026-10-28 14:17:05.249613

"""
from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '41e4767c13db'
down_revision: str | Sequence[str] | None = '230d2d621605'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # Renamed in place so existing rows keep their values. An experience can be any role
    # (a job, volunteer work), so its title and organization aren't a "job title" and "company".
    op.alter_column('experience', 'job_title', new_column_name='role_title')
    op.alter_column('experience', 'company', new_column_name='organization')


def downgrade() -> None:
    """Downgrade schema."""
    op.alter_column('experience', 'organization', new_column_name='company')
    op.alter_column('experience', 'role_title', new_column_name='job_title')
