-- Add selling_price_takeaway and selling_price_delivery to composite_products.
-- selling_price is relabelled as the dine-in price (no rename needed, kept for compatibility).
-- Uses table recreation because SQLite does not support ALTER TABLE ADD COLUMN IF NOT EXISTS.

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS composite_products_new (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    name                    TEXT    NOT NULL,
    category                TEXT,
    selling_price           REAL,
    selling_price_takeaway  REAL,
    selling_price_delivery  REAL,
    servings                INTEGER NOT NULL DEFAULT 1,
    notes                   TEXT,
    product_type            TEXT    NOT NULL DEFAULT 'composite'
                            CHECK (product_type IN ('composite', 'intermediate')),
    created_at              TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO composite_products_new
    (id, name, category, selling_price, servings, notes, product_type, created_at)
SELECT id, name, category, selling_price, servings, notes, product_type, created_at
FROM composite_products;

DROP TABLE composite_products;
ALTER TABLE composite_products_new RENAME TO composite_products;

PRAGMA foreign_keys = ON;
