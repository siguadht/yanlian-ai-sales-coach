from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from ..core.config import settings

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if settings.database_url.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def ensure_schema() -> None:
    """Create tables and add optional fields without rewriting old sessions."""
    Base.metadata.create_all(engine)
    columns = {column["name"] for column in inspect(engine).get_columns("practice_sessions")}
    if "player_role" not in columns:
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "ALTER TABLE practice_sessions ADD COLUMN player_role VARCHAR(16) NOT NULL DEFAULT 'sales'"
            )
    if "scene" not in columns:
        with engine.begin() as connection:
            connection.exec_driver_sql("ALTER TABLE practice_sessions ADD COLUMN scene VARCHAR(32)")
    if "owner_id" not in columns:
        with engine.begin() as connection:
            connection.exec_driver_sql("ALTER TABLE practice_sessions ADD COLUMN owner_id VARCHAR(64)")
            connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_practice_sessions_owner_id ON practice_sessions (owner_id)")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
