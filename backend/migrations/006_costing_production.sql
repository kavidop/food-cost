-- Phase 1: costing & production tables.
-- Adds product_type to composite_products (table recreation required because
-- composite_product_components has FK references to composite_products).
-- Also adds: unit_conversions, production_batches, recipe_yields,
-- recipe_cost_snapshots.

PRAGMA foreign_keys = OFF;

-- ── Recreate composite_products with product_type ─────────────────────────
CREATE TABLE IF NOT EXISTS composite_products_new (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    category      TEXT,
    selling_price REAL,
    servings      INTEGER NOT NULL DEFAULT 1,
    notes         TEXT,
    product_type  TEXT    NOT NULL DEFAULT 'composite'
                  CHECK (product_type IN ('composite', 'intermediate')),
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO composite_products_new
    (id, name, category, selling_price, servings, notes, created_at)
SELECT id, name, category, selling_price, servings, notes, created_at
FROM composite_products;

-- Migrate composite_product_components to point at new table
CREATE TABLE IF NOT EXISTS composite_product_components_new2 (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    composite_product_id   INTEGER NOT NULL
                            REFERENCES composite_products_new(id) ON DELETE CASCADE,
    component_product_id   INTEGER REFERENCES products(id),
    component_composite_id INTEGER REFERENCES composite_products_new(id),
    quantity               REAL    NOT NULL,
    unit                   TEXT
);

INSERT OR IGNORE INTO composite_product_components_new2
    (id, composite_product_id, component_product_id, component_composite_id, quantity, unit)
SELECT id, composite_product_id, component_product_id, component_composite_id, quantity, unit
FROM composite_product_components;

DROP TABLE composite_product_components;
ALTER TABLE composite_product_components_new2 RENAME TO composite_product_components;

DROP TABLE composite_products;
ALTER TABLE composite_products_new RENAME TO composite_products;

PRAGMA foreign_keys = ON;

-- ── unit_conversions ──────────────────────────────────────────────────────
-- Allows converting between units for a given product or globally.
-- factor: multiply from_unit qty by factor to get to_unit qty.
CREATE TABLE IF NOT EXISTS unit_conversions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    from_unit_id INTEGER NOT NULL REFERENCES units_of_measure(id),
    to_unit_id   INTEGER NOT NULL REFERENCES units_of_measure(id),
    factor       REAL    NOT NULL,
    product_id   INTEGER REFERENCES products(id),  -- NULL = global conversion
    UNIQUE (from_unit_id, to_unit_id, product_id)
);

-- ── production_batches ────────────────────────────────────────────────────
-- Records a production run that consumes ingredients and yields outputs.
CREATE TABLE IF NOT EXISTS production_batches (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    composite_product_id INTEGER NOT NULL REFERENCES composite_products(id),
    location_id          INTEGER NOT NULL REFERENCES stock_locations(id),
    batch_size           REAL    NOT NULL DEFAULT 1,
    produced_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    notes                TEXT,
    status               TEXT    NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'committed'))
);

-- ── recipe_yields ─────────────────────────────────────────────────────────
-- Defines what a production batch produces (output products/intermediates).
-- For simple composite products the yield is the composite itself.
CREATE TABLE IF NOT EXISTS recipe_yields (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    composite_product_id INTEGER NOT NULL REFERENCES composite_products(id) ON DELETE CASCADE,
    yield_product_id     INTEGER REFERENCES products(id),
    yield_composite_id   INTEGER REFERENCES composite_products(id),
    yield_quantity       REAL    NOT NULL,
    unit_id              INTEGER REFERENCES units_of_measure(id)
);

-- ── recipe_cost_snapshots ─────────────────────────────────────────────────
-- Immutable cost record taken at batch commit time.
CREATE TABLE IF NOT EXISTS recipe_cost_snapshots (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    production_batch_id  INTEGER NOT NULL REFERENCES production_batches(id) ON DELETE CASCADE,
    composite_product_id INTEGER NOT NULL REFERENCES composite_products(id),
    total_food_cost      REAL    NOT NULL,
    cost_per_serving     REAL    NOT NULL,
    snapped_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);
