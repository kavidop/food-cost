CREATE TABLE IF NOT EXISTS suppliers (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT    NOT NULL,
    trade_name       TEXT,
    vat_number       TEXT    UNIQUE,
    phone            TEXT,
    email            TEXT,
    address          TEXT,
    payment_terms    TEXT,
    is_active        INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    parent_id   INTEGER REFERENCES product_categories(id),
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS units_of_measure (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT    NOT NULL,
    abbreviation      TEXT    NOT NULL,
    base_unit_id      INTEGER REFERENCES units_of_measure(id),
    conversion_factor REAL
);

CREATE TABLE IF NOT EXISTS products (
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
    created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS supplier_products (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id            INTEGER NOT NULL REFERENCES suppliers(id),
    product_id             INTEGER NOT NULL REFERENCES products(id),
    supplier_sku           TEXT,
    supplier_product_name  TEXT,
    current_price          REAL,
    total_quantity_ordered REAL    DEFAULT 0,
    is_preferred_supplier  INTEGER NOT NULL DEFAULT 0,
    lead_time_days         INTEGER,
    min_order_qty          REAL,
    is_active              INTEGER NOT NULL DEFAULT 1,
    updated_at             TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (supplier_id, supplier_sku)
);

CREATE TABLE IF NOT EXISTS invoices (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id          INTEGER NOT NULL REFERENCES suppliers(id),
    invoice_number       TEXT    NOT NULL,
    invoice_date         TEXT    NOT NULL,
    delivery_date        TEXT,
    net_amount           REAL    NOT NULL DEFAULT 0,
    vat_amount           REAL    NOT NULL DEFAULT 0,
    excise_duty_amount   REAL    NOT NULL DEFAULT 0,
    gross_amount         REAL    NOT NULL DEFAULT 0,
    currency             TEXT    NOT NULL DEFAULT 'EUR',
    status               TEXT    NOT NULL DEFAULT 'received'
                             CHECK (status IN ('received','verified','posted','disputed')),
    notes                TEXT,
    created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (supplier_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS invoice_lines (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id            INTEGER NOT NULL REFERENCES invoices(id),
    supplier_product_id   INTEGER REFERENCES supplier_products(id),
    line_description      TEXT,
    quantity              REAL    NOT NULL,
    unit_id               INTEGER REFERENCES units_of_measure(id),
    unit_price            REAL    NOT NULL,
    discount_percent      REAL    NOT NULL DEFAULT 0,
    line_net_amount       REAL    NOT NULL,
    vat_rate              REAL    NOT NULL DEFAULT 0,
    excise_duty_per_unit  REAL    NOT NULL DEFAULT 0,
    line_gross_amount     REAL    NOT NULL
);

CREATE TABLE IF NOT EXISTS price_history (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_product_id   INTEGER NOT NULL REFERENCES supplier_products(id),
    unit_price            REAL    NOT NULL,
    vat_rate              REAL    NOT NULL DEFAULT 0,
    excise_duty_per_unit  REAL    NOT NULL DEFAULT 0,
    effective_from        TEXT    NOT NULL,
    invoice_id            INTEGER REFERENCES invoices(id),
    created_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO units_of_measure (id, name, abbreviation, base_unit_id, conversion_factor)
VALUES
    (1, 'Bottle',  'btl', NULL, NULL),
    (2, 'Case',    'cs',  1,    6.0),
    (3, 'Kilogram','kg',  NULL, NULL),
    (4, 'Litre',   'L',   NULL, NULL),
    (5, 'Can',     'can', NULL, NULL),
    (6, 'Piece',   'pcs', NULL, NULL),
    (7, 'Box',     'kbt', NULL, NULL);
