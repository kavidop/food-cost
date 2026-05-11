import sqlite3
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).parent


def run_migrations(db_path: str) -> None:
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version    INTEGER PRIMARY KEY,
            name       TEXT    NOT NULL,
            applied_at TEXT    NOT NULL DEFAULT (datetime('now'))
        )
    """)
    conn.commit()

    applied = {r[0] for r in conn.execute("SELECT version FROM schema_migrations").fetchall()}

    migration_files = sorted(
        f for f in MIGRATIONS_DIR.glob("*.sql")
        if f.stem[0].isdigit()
    )

    for f in migration_files:
        version = int(f.stem.split("_")[0])
        if version in applied:
            continue
        print(f"  Applying migration {f.name}...")
        conn.executescript(f.read_text(encoding="utf-8"))
        conn.execute(
            "INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
            (version, f.stem),
        )
        conn.commit()

    conn.close()
