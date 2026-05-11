-- Allow composite products to be used as ingredients in other composite products.
-- Recreate the components table with component_product_id nullable and a new
-- component_composite_id column (exactly one of the two must be non-null).

CREATE TABLE composite_product_components_new (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    composite_product_id   INTEGER NOT NULL
                            REFERENCES composite_products(id) ON DELETE CASCADE,
    component_product_id   INTEGER REFERENCES products(id),
    component_composite_id INTEGER REFERENCES composite_products(id),
    quantity               REAL    NOT NULL,
    unit                   TEXT
);

INSERT INTO composite_product_components_new
    (id, composite_product_id, component_product_id, quantity, unit)
SELECT id, composite_product_id, component_product_id, quantity, unit
FROM composite_product_components;

DROP TABLE composite_product_components;
ALTER TABLE composite_product_components_new RENAME TO composite_product_components;
