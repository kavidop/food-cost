-- Transfer sessions: move stock between locations

CREATE TABLE IF NOT EXISTS stock_transfers (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    from_location_id INTEGER NOT NULL REFERENCES stock_locations(id),
    to_location_id   INTEGER NOT NULL REFERENCES stock_locations(id),
    status           TEXT    NOT NULL DEFAULT 'draft',
    notes            TEXT,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    confirmed_at     TEXT,
    cancelled_at     TEXT
);

CREATE TABLE IF NOT EXISTS stock_transfer_lines (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    transfer_id INTEGER NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
    product_id  INTEGER NOT NULL REFERENCES products(id),
    quantity    REAL    NOT NULL,
    unit_id     INTEGER REFERENCES units_of_measure(id),
    notes       TEXT
);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_status        ON stock_transfers(status);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_from_loc      ON stock_transfers(from_location_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_to_loc        ON stock_transfers(to_location_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_lines_transfer ON stock_transfer_lines(transfer_id);
