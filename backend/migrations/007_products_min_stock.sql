-- Add min_stock_level to products for per-product low-stock threshold.
-- Uses table recreation because SQLite does not support ALTER TABLE ADD COLUMN IF NOT EXISTS.

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS products_new (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT    NOT NULL,
    description       TEXT,
    category_id       INTEGER REFERENCES product_categories(id),
    unit_id           INTEGER REFERENCES units_of_measure(id),
    volume_ml         INTEGER,
    abv_percent       REAL,
    units_per_pack    REAL,
    pack_unit_id      INTEGER REFERENCES units_of_measure(id),
    pack_unit_size_ml REAL,
    barcode           TEXT,
    is_active         INTEGER NOT NULL DEFAULT 1,
    min_stock_level   REAL,
    created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO products_new
    (id, name, description, category_id, unit_id,
     volume_ml, abv_percent, units_per_pack, pack_unit_id, pack_unit_size_ml,
     barcode, is_active, created_at)
SELECT id, name, description, category_id, unit_id,
       volume_ml, abv_percent, units_per_pack, pack_unit_id, pack_unit_size_ml,
       barcode, is_active, created_at
FROM products;

DROP TABLE products;
ALTER TABLE products_new RENAME TO products;

PRAGMA foreign_keys = ON;
