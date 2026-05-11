-- Add yield metadata and archive flag to composite_products.
-- Uses table recreation (SQLite does not support idempotent ADD COLUMN).

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS composite_products_new (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    name                    TEXT    NOT NULL,
    category                TEXT,
    selling_price           REAL,
    selling_price_takeaway  REAL,
    selling_price_delivery  REAL,
    servings                INTEGER NOT NULL DEFAULT 1,
    yield_quantity          REAL,
    yield_unit              TEXT,
    prep_time_minutes       INTEGER,
    notes                   TEXT,
    product_type            TEXT    NOT NULL DEFAULT 'composite'
                            CHECK (product_type IN ('composite', 'intermediate')),
    is_archived             INTEGER NOT NULL DEFAULT 0,
    created_at              TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO composite_products_new
    (id, name, category, selling_price, selling_price_takeaway, selling_price_delivery,
     servings, notes, product_type, created_at)
SELECT id, name, category, selling_price, selling_price_takeaway, selling_price_delivery,
       servings, notes, product_type, created_at
FROM composite_products;

DROP TABLE composite_products;
ALTER TABLE composite_products_new RENAME TO composite_products;

PRAGMA foreign_keys = ON;
