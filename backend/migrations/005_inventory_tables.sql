-- Inventory foundation: locations, signed-quantity ledger, denormalized balances,
-- and physical stock count sessions.
-- waste_events is NOT a separate table — waste is a stock_movement with reason.

-- ── stock_locations ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_locations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active  INTEGER NOT NULL DEFAULT 1
);

-- ── stock_movements (append-only ledger) ──────────────────────────────────
-- quantity is SIGNED: positive = stock enters, negative = stock leaves.
-- movement_type labels the business event; the sign encodes direction.
-- reason is free text for waste causes, adjustment notes, etc.
-- reference_id / reference_type point to the originating record.
CREATE TABLE IF NOT EXISTS stock_movements (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id     INTEGER NOT NULL REFERENCES products(id),
    location_id    INTEGER NOT NULL REFERENCES stock_locations(id),
    movement_type  TEXT    NOT NULL
                   CHECK (movement_type IN (
                       'purchase_receipt',
                       'adjustment_up',
                       'adjustment_down',
                       'waste',
                       'transfer_out',
                       'transfer_in',
                       'production_consumption',
                       'production_output',
                       'count_reconciliation',
                       'opening'
                   )),
    quantity       REAL    NOT NULL,
    unit_id        INTEGER REFERENCES units_of_measure(id),
    reason         TEXT,
    reference_id   INTEGER,
    reference_type TEXT,
    notes          TEXT,
    moved_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_product
    ON stock_movements (product_id, location_id);

-- ── inventory_balances (denormalized running total) ────────────────────────
CREATE TABLE IF NOT EXISTS inventory_balances (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id   INTEGER NOT NULL REFERENCES products(id),
    location_id  INTEGER NOT NULL REFERENCES stock_locations(id),
    quantity     REAL    NOT NULL DEFAULT 0,
    unit_id      INTEGER REFERENCES units_of_measure(id),
    last_updated TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (product_id, location_id)
);

-- ── stock_count_sessions ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_count_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    location_id INTEGER NOT NULL REFERENCES stock_locations(id),
    counted_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    notes       TEXT,
    status      TEXT    NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'committed'))
);

CREATE TABLE IF NOT EXISTS stock_count_lines (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  INTEGER NOT NULL REFERENCES stock_count_sessions(id) ON DELETE CASCADE,
    product_id  INTEGER NOT NULL REFERENCES products(id),
    counted_qty REAL    NOT NULL,
    system_qty  REAL,
    unit_id     INTEGER REFERENCES units_of_measure(id),
    notes       TEXT,
    UNIQUE (session_id, product_id)
);

-- ── Seed default location ─────────────────────────────────────────────────
INSERT OR IGNORE INTO stock_locations (id, name, sort_order) VALUES (1, 'Main', 0);

-- ── Bootstrap inventory_balances from purchase history ────────────────────
-- Approximate: total ever purchased per product becomes opening on-hand.
-- Run a physical stock count to correct these values.
INSERT OR IGNORE INTO inventory_balances (product_id, location_id, quantity, unit_id)
SELECT
    p.id,
    1,
    COALESCE((
        SELECT SUM(sp.total_quantity_ordered)
        FROM supplier_products sp
        WHERE sp.product_id = p.id
    ), 0),
    p.unit_id
FROM products p;

-- Record bootstrap as opening movements (idempotent: skips if already present)
INSERT INTO stock_movements
    (product_id, location_id, movement_type, quantity, unit_id, reference_type, notes)
SELECT
    ib.product_id,
    ib.location_id,
    'opening',
    ib.quantity,
    ib.unit_id,
    'bootstrap',
    'Seeded from purchase history totals (migration 005)'
FROM inventory_balances ib
WHERE ib.quantity > 0
  AND NOT EXISTS (
      SELECT 1 FROM stock_movements sm
      WHERE sm.product_id    = ib.product_id
        AND sm.location_id   = ib.location_id
        AND sm.movement_type = 'opening'
  );
