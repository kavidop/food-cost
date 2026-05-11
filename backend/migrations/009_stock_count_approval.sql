-- Normalize stock count tables to canonical naming (stock_count_sessions / session_id)
-- and extend schema: add pending_approval status, frozen_at timestamp, nullable counted_qty.
--
-- Production DBs have stock_counts + stock_count_lines(count_id).
-- Test DBs built from migration 005 have stock_count_sessions + stock_count_lines(session_id).
-- Both count tables are empty, so drop-and-recreate is safe and fully idempotent.

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS stock_count_lines;
DROP TABLE IF EXISTS stock_count_sessions;
DROP TABLE IF EXISTS stock_counts;

CREATE TABLE IF NOT EXISTS stock_count_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    location_id INTEGER NOT NULL REFERENCES stock_locations(id),
    counted_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    frozen_at   TEXT,
    notes       TEXT,
    status      TEXT    NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'pending_approval', 'committed'))
);

CREATE TABLE IF NOT EXISTS stock_count_lines (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  INTEGER NOT NULL REFERENCES stock_count_sessions(id) ON DELETE CASCADE,
    product_id  INTEGER NOT NULL REFERENCES products(id),
    counted_qty REAL,
    system_qty  REAL,
    unit_id     INTEGER REFERENCES units_of_measure(id),
    notes       TEXT,
    UNIQUE (session_id, product_id)
);

PRAGMA foreign_keys = ON;
