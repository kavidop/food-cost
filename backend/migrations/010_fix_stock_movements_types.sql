-- Fix stock_movements: add reason column and expand movement_type CHECK constraint.
-- Production DBs were built from an older migration 005 that used shorter type names
-- and lacked the reason column.  Only 'opening' rows exist in production, so the
-- data migration is straightforward.  Old type names are remapped:
--   purchase   → purchase_receipt
--   consumption → production_consumption
--   adjustment  → adjustment_up / adjustment_down (by sign)
-- Other types (opening, waste, transfer_in, transfer_out) pass through unchanged.

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS stock_movements_new (
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

INSERT OR IGNORE INTO stock_movements_new
    (id, product_id, location_id, movement_type, quantity,
     unit_id, reason, reference_id, reference_type, notes, moved_at, created_at)
SELECT
    id, product_id, location_id,
    CASE movement_type
        WHEN 'purchase'     THEN 'purchase_receipt'
        WHEN 'consumption'  THEN 'production_consumption'
        WHEN 'adjustment'   THEN CASE WHEN quantity >= 0 THEN 'adjustment_up' ELSE 'adjustment_down' END
        ELSE movement_type
    END,
    quantity, unit_id,
    NULL,   -- reason column absent in old schema; NULL is safe
    reference_id, reference_type, notes, moved_at, created_at
FROM stock_movements;

DROP TABLE stock_movements;
ALTER TABLE stock_movements_new RENAME TO stock_movements;

CREATE INDEX IF NOT EXISTS idx_stock_movements_product
    ON stock_movements (product_id, location_id);

PRAGMA foreign_keys = ON;
