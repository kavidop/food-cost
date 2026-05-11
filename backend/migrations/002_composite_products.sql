CREATE TABLE IF NOT EXISTS composite_products (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    category      TEXT,
    selling_price REAL,
    servings      INTEGER NOT NULL DEFAULT 1,
    notes         TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS composite_product_components (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    composite_product_id INTEGER NOT NULL
                          REFERENCES composite_products(id) ON DELETE CASCADE,
    component_product_id INTEGER NOT NULL
                          REFERENCES products(id),
    quantity             REAL    NOT NULL,
    unit                 TEXT
);
