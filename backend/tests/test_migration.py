from sqlalchemy import create_engine, inspect

from app.models import database


def test_existing_sessions_default_to_sales_role(tmp_path, monkeypatch):
    old_engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with old_engine.begin() as connection:
        connection.exec_driver_sql(
            "CREATE TABLE practice_sessions (id VARCHAR(32) PRIMARY KEY, industry VARCHAR(32), "
            "customer_type VARCHAR(32), difficulty VARCHAR(32), status VARCHAR(32))"
        )
        connection.exec_driver_sql(
            "INSERT INTO practice_sessions (id, industry, customer_type, difficulty, status) "
            "VALUES ('old-session', '装修', '挑剔型', '温和', 'in_progress')"
        )
    monkeypatch.setattr(database, "engine", old_engine)
    database.ensure_schema()
    assert "player_role" in {c["name"] for c in inspect(old_engine).get_columns("practice_sessions")}
    assert "scene" in {c["name"] for c in inspect(old_engine).get_columns("practice_sessions")}
    database.ensure_schema()
    with old_engine.connect() as connection:
        assert connection.exec_driver_sql(
            "SELECT player_role FROM practice_sessions WHERE id='old-session'"
        ).scalar_one() == "sales"
        assert connection.exec_driver_sql(
            "SELECT scene FROM practice_sessions WHERE id='old-session'"
        ).scalar_one() is None
