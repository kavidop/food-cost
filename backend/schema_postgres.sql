-- ============================================================
-- Zubro Food Cost — PostgreSQL schema (Supabase)
-- Single-file authoritative schema replacing the SQLite migrations.
-- Apply once via the Supabase SQL Editor or psql.
-- All tables live in the "food_cost" schema to avoid collisions
-- with other apps sharing this Supabase project.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS food_cost;
SET search_path TO food_cost;

-- ── Migration tracker ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Reference: units of measure ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS units_of_measure (
    id                SERIAL PRIMARY KEY,
    name              TEXT           NOT NULL,
    abbreviation      TEXT           NOT NULL,
    base_unit_id      INTEGER        REFERENCES units_of_measure(id),
    conversion_factor DOUBLE PRECISION
);

-- ── Reference: product categories (hierarchical) ─────────────────────────
CREATE TABLE IF NOT EXISTS product_categories (
    id         SERIAL PRIMARY KEY,
    name       TEXT        NOT NULL UNIQUE,
    parent_id  INTEGER     REFERENCES product_categories(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Suppliers ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suppliers (
    id             SERIAL PRIMARY KEY,
    name           TEXT        NOT NULL,
    trade_name     TEXT,
    vat_number     TEXT        UNIQUE,
    phone          TEXT,
    email          TEXT,
    address        TEXT,
    payment_terms  TEXT,
    is_active      SMALLINT    NOT NULL DEFAULT 1,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Products ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
    id                SERIAL PRIMARY KEY,
    name              TEXT             NOT NULL,
    description       TEXT,
    category_id       INTEGER          REFERENCES product_categories(id),
    unit_id           INTEGER          REFERENCES units_of_measure(id),
    volume_ml         DOUBLE PRECISION,
    abv_percent       DOUBLE PRECISION,
    units_per_pack    DOUBLE PRECISION,
    pack_unit_id      INTEGER          REFERENCES units_of_measure(id),
    pack_unit_size_ml DOUBLE PRECISION,
    barcode           TEXT,
    is_active         SMALLINT         NOT NULL DEFAULT 1,
    min_stock_level   DOUBLE PRECISION,
    created_at        TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

-- ── Supplier ↔ Product links ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supplier_products (
    id                     SERIAL PRIMARY KEY,
    supplier_id            INTEGER          NOT NULL REFERENCES suppliers(id),
    product_id             INTEGER          NOT NULL REFERENCES products(id),
    supplier_sku           TEXT,
    supplier_product_name  TEXT,
    current_price          NUMERIC(14,4),
    total_quantity_ordered DOUBLE PRECISION NOT NULL DEFAULT 0,
    is_preferred_supplier  SMALLINT         NOT NULL DEFAULT 0,
    lead_time_days         INTEGER,
    min_order_qty          DOUBLE PRECISION,
    is_active              SMALLINT         NOT NULL DEFAULT 1,
    updated_at             TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    UNIQUE (supplier_id, supplier_sku)
);

-- ── Invoices ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
    id                 SERIAL PRIMARY KEY,
    supplier_id        INTEGER      NOT NULL REFERENCES suppliers(id),
    invoice_number     TEXT         NOT NULL,
    invoice_date       DATE         NOT NULL,
    delivery_date      DATE,
    net_amount         NUMERIC(14,4) NOT NULL DEFAULT 0,
    vat_amount         NUMERIC(14,4) NOT NULL DEFAULT 0,
    excise_duty_amount NUMERIC(14,4) NOT NULL DEFAULT 0,
    gross_amount       NUMERIC(14,4) NOT NULL DEFAULT 0,
    currency           TEXT         NOT NULL DEFAULT 'EUR',
    invoice_type       TEXT         NOT NULL DEFAULT 'invoice'
                           CHECK (invoice_type IN ('invoice', 'credit_note')),
    status             TEXT         NOT NULL DEFAULT 'received'
                           CHECK (status IN ('received','verified','posted','disputed')),
    notes              TEXT,
    pdf_path           TEXT,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (supplier_id, invoice_number)
);

-- ── Invoice lines ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_lines (
    id                   SERIAL PRIMARY KEY,
    invoice_id           INTEGER       NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    supplier_product_id  INTEGER       REFERENCES supplier_products(id),
    line_description     TEXT,
    quantity             DOUBLE PRECISION NOT NULL,
    unit_id              INTEGER       REFERENCES units_of_measure(id),
    unit_price           NUMERIC(14,4) NOT NULL,
    discount_percent     NUMERIC(7,4)  NOT NULL DEFAULT 0,
    line_net_amount      NUMERIC(14,4) NOT NULL,
    vat_rate             NUMERIC(7,4)  NOT NULL DEFAULT 0,
    excise_duty_per_unit NUMERIC(14,4) NOT NULL DEFAULT 0,
    line_gross_amount    NUMERIC(14,4) NOT NULL
);

-- ── Price history ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS price_history (
    id                   SERIAL PRIMARY KEY,
    supplier_product_id  INTEGER       NOT NULL REFERENCES supplier_products(id),
    unit_price           NUMERIC(14,4) NOT NULL,
    vat_rate             NUMERIC(7,4)  NOT NULL DEFAULT 0,
    excise_duty_per_unit NUMERIC(14,4) NOT NULL DEFAULT 0,
    effective_from       DATE          NOT NULL,
    invoice_id           INTEGER       REFERENCES invoices(id),
    created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── Composite products (recipes) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS composite_products (
    id                     SERIAL PRIMARY KEY,
    name                   TEXT         NOT NULL,
    category               TEXT,
    selling_price          NUMERIC(14,4),
    selling_price_takeaway NUMERIC(14,4),
    selling_price_delivery NUMERIC(14,4),
    servings               INTEGER      NOT NULL DEFAULT 1,
    yield_quantity         DOUBLE PRECISION,
    yield_unit             TEXT,
    prep_time_minutes      INTEGER,
    notes                  TEXT,
    product_type           TEXT         NOT NULL DEFAULT 'composite'
                           CHECK (product_type IN ('composite', 'intermediate')),
    is_archived            SMALLINT     NOT NULL DEFAULT 0,
    created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Recipe components (BOM) ───────────────────────────────────────────────
-- Exactly one of component_product_id or component_composite_id must be set.
CREATE TABLE IF NOT EXISTS composite_product_components (
    id                     SERIAL PRIMARY KEY,
    composite_product_id   INTEGER          NOT NULL REFERENCES composite_products(id) ON DELETE CASCADE,
    component_product_id   INTEGER          REFERENCES products(id),
    component_composite_id INTEGER          REFERENCES composite_products(id),
    quantity               DOUBLE PRECISION NOT NULL,
    unit                   TEXT
);

-- ── Unit conversions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS unit_conversions (
    id           SERIAL PRIMARY KEY,
    from_unit_id INTEGER          NOT NULL REFERENCES units_of_measure(id),
    to_unit_id   INTEGER          NOT NULL REFERENCES units_of_measure(id),
    factor       DOUBLE PRECISION NOT NULL,
    product_id   INTEGER          REFERENCES products(id),
    UNIQUE (from_unit_id, to_unit_id, product_id)
);

-- ── Stock locations ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_locations (
    id         SERIAL PRIMARY KEY,
    name       TEXT    NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active  SMALLINT    NOT NULL DEFAULT 1
);

-- ── Stock movements (append-only signed-quantity ledger) ──────────────────
CREATE TABLE IF NOT EXISTS stock_movements (
    id             SERIAL PRIMARY KEY,
    product_id     INTEGER          NOT NULL REFERENCES products(id),
    location_id    INTEGER          NOT NULL REFERENCES stock_locations(id),
    movement_type  TEXT             NOT NULL
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
                       'opening',
                       'receipt_pending',
                       'return_to_supplier'
                   )),
    quantity       DOUBLE PRECISION NOT NULL,
    unit_id        INTEGER          REFERENCES units_of_measure(id),
    reason         TEXT,
    reference_id   INTEGER,
    reference_type TEXT,
    notes          TEXT,
    moved_at       TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    created_at     TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_product
    ON stock_movements (product_id, location_id);

CREATE INDEX IF NOT EXISTS idx_stock_movements_moved_at
    ON stock_movements (moved_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_movements_ref
    ON stock_movements (reference_type, reference_id);

CREATE INDEX IF NOT EXISTS idx_stock_movements_type
    ON stock_movements (movement_type);

-- ── Performance indexes (run once if not present) ─────────────────────────
CREATE INDEX IF NOT EXISTS idx_supplier_products_product_id
    ON supplier_products (product_id);

CREATE INDEX IF NOT EXISTS idx_invoice_lines_supplier_product_id
    ON invoice_lines (supplier_product_id);

CREATE INDEX IF NOT EXISTS idx_price_history_supplier_product_id
    ON price_history (supplier_product_id, effective_from DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_balances_product_id
    ON inventory_balances (product_id);

-- ── Inventory balances (denormalized running total) ───────────────────────
CREATE TABLE IF NOT EXISTS inventory_balances (
    id           SERIAL PRIMARY KEY,
    product_id   INTEGER          NOT NULL REFERENCES products(id),
    location_id  INTEGER          NOT NULL REFERENCES stock_locations(id),
    quantity     DOUBLE PRECISION NOT NULL DEFAULT 0,
    unit_id      INTEGER          REFERENCES units_of_measure(id),
    last_updated TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    UNIQUE (product_id, location_id)
);

-- ── Stock count sessions ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_count_sessions (
    id          SERIAL PRIMARY KEY,
    location_id INTEGER     NOT NULL REFERENCES stock_locations(id),
    counted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    frozen_at   TIMESTAMPTZ,
    count_date  DATE,
    notes       TEXT,
    status      TEXT        NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'pending_approval', 'committed'))
);

CREATE TABLE IF NOT EXISTS stock_count_lines (
    id          SERIAL PRIMARY KEY,
    session_id  INTEGER          NOT NULL REFERENCES stock_count_sessions(id) ON DELETE CASCADE,
    product_id  INTEGER          NOT NULL REFERENCES products(id),
    counted_qty DOUBLE PRECISION,
    system_qty  DOUBLE PRECISION,
    unit_id     INTEGER          REFERENCES units_of_measure(id),
    notes       TEXT,
    UNIQUE (session_id, product_id)
);

-- ── Stock transfers ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_transfers (
    id               SERIAL PRIMARY KEY,
    from_location_id INTEGER     NOT NULL REFERENCES stock_locations(id),
    to_location_id   INTEGER     NOT NULL REFERENCES stock_locations(id),
    status           TEXT        NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'confirmed', 'cancelled')),
    notes            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at     TIMESTAMPTZ,
    cancelled_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS stock_transfer_lines (
    id          SERIAL PRIMARY KEY,
    transfer_id INTEGER          NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
    product_id  INTEGER          NOT NULL REFERENCES products(id),
    quantity    DOUBLE PRECISION NOT NULL,
    unit_id     INTEGER          REFERENCES units_of_measure(id),
    notes       TEXT
);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_status   ON stock_transfers(status);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_from_loc ON stock_transfers(from_location_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_to_loc   ON stock_transfers(to_location_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_lines_tid ON stock_transfer_lines(transfer_id);

-- ── Production batches ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS production_batches (
    id                   SERIAL PRIMARY KEY,
    composite_product_id INTEGER          NOT NULL REFERENCES composite_products(id),
    location_id          INTEGER          NOT NULL REFERENCES stock_locations(id),
    batch_size           DOUBLE PRECISION NOT NULL DEFAULT 1,
    produced_at          TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    notes                TEXT,
    status               TEXT             NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'committed'))
);

CREATE TABLE IF NOT EXISTS recipe_yields (
    id                   SERIAL PRIMARY KEY,
    composite_product_id INTEGER          NOT NULL REFERENCES composite_products(id) ON DELETE CASCADE,
    yield_product_id     INTEGER          REFERENCES products(id),
    yield_composite_id   INTEGER          REFERENCES composite_products(id),
    yield_quantity       DOUBLE PRECISION NOT NULL,
    unit_id              INTEGER          REFERENCES units_of_measure(id)
);

CREATE TABLE IF NOT EXISTS recipe_cost_snapshots (
    id                   SERIAL PRIMARY KEY,
    production_batch_id  INTEGER       NOT NULL REFERENCES production_batches(id) ON DELETE CASCADE,
    composite_product_id INTEGER       NOT NULL REFERENCES composite_products(id),
    total_food_cost      NUMERIC(14,4) NOT NULL,
    cost_per_serving     NUMERIC(14,4) NOT NULL,
    snapped_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Seed data
-- ============================================================

-- Units of measure
INSERT INTO units_of_measure (id, name, abbreviation, base_unit_id, conversion_factor) VALUES
    (1, 'Bottle',   'btl', NULL, NULL),
    (2, 'Case',     'cs',  1,    6.0),
    (3, 'Kilogram', 'kg',  NULL, NULL),
    (4, 'Litre',    'L',   NULL, NULL),
    (5, 'Can',      'can', NULL, NULL),
    (6, 'Piece',    'pcs', NULL, NULL),
    (7, 'Box',      'kbt', NULL, NULL),
    (8, 'Gram',     'g',   3,    0.001),
    (9, 'Millilitre','ml', 4,    0.001)
ON CONFLICT (id) DO NOTHING;

-- Advance the sequence past the seeded IDs
SELECT setval('units_of_measure_id_seq', (SELECT MAX(id) FROM units_of_measure));

-- Product categories
INSERT INTO product_categories (id, name, parent_id) VALUES
    (1,  'Beverages',              NULL),
    (2,  'Alcoholic',              1),
    (3,  'Non-Alcoholic',          1),
    (4,  'Beer',                   2),
    (5,  'Wine',                   2),
    (6,  'White Wine',             5),
    (7,  'Rosé Wine',              5),
    (8,  'Red Wine',               5),
    (9,  'Sparkling Wine',         5),
    (10, 'Spirits',                2),
    (11, 'Vodka',                  10),
    (12, 'Gin',                    10),
    (13, 'Rum',                    10),
    (14, 'Tequila',                10),
    (15, 'Whiskey',                10),
    (16, 'Liqueur',                10),
    (17, 'Aperitif',               10),
    (18, 'Cachaça',                10),
    (19, 'Syrups & Purées',        1),
    (20, 'Syrups',                 19),
    (21, 'Fruit Purées',           19),
    (22, 'Energy Drinks',          3),
    (23, 'Soft Drinks',            3),
    (24, 'Coffee & Hot Beverages', 3),
    (25, 'Dairy & Cheese',         NULL),
    (26, 'Oils & Vinegars',        NULL),
    (27, 'Condiments & Preserves', NULL),
    (28, 'Spices & Herbs',         NULL),
    (29, 'Bakery & Confectionery', NULL),
    (30, 'Sugar & Sweeteners',     NULL),
    (31, 'Savory Pies',            NULL),
    (32, 'Kitchen Supplies',       NULL)
ON CONFLICT (id) DO NOTHING;

SELECT setval('product_categories_id_seq', (SELECT MAX(id) FROM product_categories));

-- Default stock location
INSERT INTO stock_locations (id, name, sort_order) VALUES (1, 'Main', 0)
ON CONFLICT (id) DO NOTHING;

SELECT setval('stock_locations_id_seq', (SELECT MAX(id) FROM stock_locations));
