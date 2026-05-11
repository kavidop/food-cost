import os
import psycopg2
import psycopg2.extras
import psycopg2.pool
from decimal import Decimal
from typing import Generator

from .config import settings

_pool: psycopg2.pool.ThreadedConnectionPool | None = None


def _get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    global _pool
    if _pool is None:
        minconn = int(os.getenv("DB_POOL_MIN", "2"))
        maxconn = int(os.getenv("DB_POOL_MAX", "10"))
        _pool = psycopg2.pool.ThreadedConnectionPool(
            minconn, maxconn,
            dsn=settings.database_url,
            options="-c search_path=food_cost",
        )
    return _pool


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.closeall()
        _pool = None


class Row(dict):
    """Result row that supports both name-based and positional index access.

    Decimal values from PostgreSQL NUMERIC columns are normalised to float on
    construction so application code never has to deal with mixed types.
    """

    def __init__(self, data):
        super().__init__(
            {k: float(v) if isinstance(v, Decimal) else v for k, v in data.items()}
        )

    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


class PGCursor:
    """Wraps a psycopg2 RealDictCursor with a sqlite3-compatible interface."""

    def __init__(self, raw_cursor):
        self._cur = raw_cursor
        self._lastrowid: int | None = None
        self.connection: "PGConnection | None" = None

    def execute(self, sql: str, params=None) -> "PGCursor":
        stripped = sql.strip()
        upper = stripped.upper()
        needs_returning = (
            upper.startswith("INSERT") and
            "RETURNING" not in upper
        )
        if needs_returning:
            sql = stripped.rstrip(";").rstrip() + " RETURNING id"

        self._cur.execute(sql, params)

        if needs_returning:
            row = self._cur.fetchone()
            self._lastrowid = row["id"] if row is not None else None

        return self

    def fetchone(self):
        row = self._cur.fetchone()
        return Row(row) if row is not None else None

    def fetchall(self):
        return [Row(r) for r in self._cur.fetchall()]

    @property
    def lastrowid(self) -> int | None:
        return self._lastrowid

    @property
    def rowcount(self) -> int:
        return self._cur.rowcount

    def __iter__(self):
        return (Row(r) for r in self._cur)


class PGConnection:
    """Wraps a psycopg2 connection with a sqlite3-compatible interface."""

    def __init__(self, raw_conn):
        self._conn = raw_conn

    def execute(self, sql: str, params=None) -> PGCursor:
        cur = PGCursor(self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor))
        cur.connection = self
        cur.execute(sql, params)
        return cur

    def cursor(self) -> PGCursor:
        cur = PGCursor(self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor))
        cur.connection = self
        return cur

    def commit(self) -> None:
        self._conn.commit()

    def rollback(self) -> None:
        self._conn.rollback()

    def close(self) -> None:
        # No-op: connection is returned to the pool by get_db(), not closed here.
        pass


def get_db() -> Generator[PGConnection, None, None]:
    pool = _get_pool()
    conn = pool.getconn()
    pg = PGConnection(conn)
    try:
        yield pg
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        pool.putconn(conn, close=True)
        raise
    else:
        try:
            conn.rollback()
        except Exception:
            pass
        pool.putconn(conn)

