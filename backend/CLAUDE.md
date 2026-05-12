# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working Protocol
- Always read this file before starting any task
- Propose a plan identifying which files are involved before reading or editing them
- Wait for user approval before proceeding
- Only read files that are part of the approved plan

## Repository layout

```
backend/
  app/
    routes/        Thin HTTP controllers — no business logic, one file per domain
    repositories/  All SQL queries and business logic (replaced services/ pattern)
    services/      Only two remain: inventory_posting_service.py, ai_service.py
    schemas/       Pydantic request/response models, one file per domain
    protocols.py   DBConnection / CursorProtocol — type stubs for the PG wrapper
    database.py    get_db() — yields PGConnection (psycopg2 wrapper, see below)
    main.py        FastAPI app factory; registers all routers under /api
  schema_postgres.sql  Authoritative PostgreSQL schema (apply once via Supabase SQL Editor)
  tests/           pytest (fixtures use in-memory SQLite — some tests may lag schema)
```

## Commands

```bash
python run.py          # dev server on :8000 with reload (run from backend/)
python -m pytest       # all tests
```

## Database: PostgreSQL via Supabase

The project migrated from SQLite to PostgreSQL. Key points:

- **Connection pooling**: `get_db()` uses a `psycopg2.pool.ThreadedConnectionPool` (configurable via `DB_POOL_MIN`/`DB_POOL_MAX` env vars, defaults 2/10). Connections acquired per request, rolled back, and returned to the pool. `PGConnection.close()` is a no-op. The pool is closed on app shutdown via the FastAPI lifespan handler (calls `close_pool()`).
- **Wrapper**: `PGConnection`/`PGCursor` in `database.py` emulates the sqlite3 interface. All `%s` placeholders (not `?`).
- **Schema**: `food_cost` search_path; all tables live in that schema.
- **`lastrowid`**: The `PGCursor` wrapper auto-appends `RETURNING id` to `INSERT` statements and captures the result — `cur.lastrowid` works as expected.
- **`execute(sql, None)`**: Safe — psycopg2 treats `None` params as no substitution.
- **`Row`**: All result rows are `dict` subclasses with Decimal→float normalization and integer index support.

## Repository pattern

Routes import from `repositories/`, never from `services/` (except `inventory_posting_service`).

```python
class FooRepository:
    def __init__(self, db: DBConnection) -> None:
        self.db = db
    # use self.db.execute(sql, params) for reads and simple writes
    # use cur = self.db.cursor(); cur.execute(...) when you need cur.lastrowid

def get_foo_repo(db: DBConnection = Depends(get_db)) -> FooRepository:
    return FooRepository(db)
```

Repositories return `list[dict]` or `dict | None` — never Pydantic objects.

## Inventory ledger (unchanged from SQLite era)

- `stock_movements` — append-only signed-quantity ledger (positive = in, negative = out).
- `inventory_balances` — denormalized running total; upserted via `ON CONFLICT DO UPDATE SET quantity = quantity + excluded.quantity`.
- Valid `movement_type` values: `purchase_receipt`, `adjustment_up`, `adjustment_down`, `waste`, `transfer_out`, `transfer_in`, `production_consumption`, `production_output`, `count_reconciliation`, `opening`, `receipt_pending`.
- `receipt_pending` — stock received without an invoice. `reference_id IS NULL` means unlinked. Link via `POST /movements/{id}/link-invoice-line`. The CHECK constraint in the live DB must include this value (run the migration SQL if not).
- **Use `post_movements()`** from `services/inventory_posting_service.py` for all ledger writes. It handles balance upsert and optional negativity guard.

## Composite products and intermediate products

`composite_products.product_type` distinguishes:
- `'composite'` — final recipes (default)
- `'intermediate'` — prep items (syrups, sauces, doughs, etc.)

When creating an intermediate product, the repository auto-creates a **shadow `products` row** (same name) and links it via `recipe_yields.yield_product_id`. This shadow product receives `production_output` stock movements when a batch is posted. Query `recipe_yields` to find a composite product's linked stock product.

`_calc_composite(cur, cp_id)` in `RecipeRepository` now includes `eff_qty` on each product component (unit-converted quantity, used for production consumption calculations).

Production batch posting: `POST /composite-products/{id}/produce` → `create_production_batch()` in `RecipeRepository`.

## Filter + sort pattern (used in list endpoints)

Build conditions and params lists conditionally, pass `params if params else None` to avoid empty-list issues:

```python
def list_foo(self, supplier_id=None, date_from=None, sort_by="date", sort_dir="desc"):
    conditions, params = [], []
    if supplier_id:
        conditions.append("i.supplier_id = %s"); params.append(supplier_id)
    if date_from:
        conditions.append("i.date >= %s"); params.append(date_from)
    where = " WHERE " + " AND ".join(conditions) if conditions else ""
    # Allowlist sort_col to prevent injection:
    sort_col = "i.date" if sort_by == "date" else "supplier_name"
    direction = "DESC" if sort_dir.lower() == "desc" else "ASC"
    return self.db.execute(f"SELECT ... {where} ORDER BY {sort_col} {direction}",
                           params if params else None).fetchall()
```

Route receives params via `Query(None)` and forwards them to the repository method.

## Inventory unit normalisation

`InventoryRepository` normalises all displayed quantities to the product's **retail unit** (e.g. bottles/btl), converting from pack units (e.g. boxes/kbt) using `units_per_pack`:

- `get_product_detail()` fetches `pack_unit_id`/`pack_unit` from products, normalises each balance line, and computes `total_on_hand` in retail units. Stock value uses wholesale quantity: `(total_on_hand / units_per_pack) * cost`.
- Balance unit fallback: if `ib.unit_id` doesn't match the product's current `unit_id` or `pack_unit_id`, the display unit is overridden to the product's current retail unit (handles product unit renames/changes).
- Movement unit fallback: `get_product_movements()` uses a CASE expression — shows pack unit if `sm.unit_id = p.pack_unit_id`, otherwise always shows the product's current retail unit. Prevents stale unit labels after product edits.
- `_to_balance_units(product_id, location_id, quantity)` converts a retail-unit input to the unit stored in `inventory_balances` for that location. Defaults to pack unit when no balance exists yet.
- `adjust_stock()`, `record_waste()`, `transfer_stock()` all call `_to_balance_units()` so operations work in the balance's native unit.
- `transfer_stock()` mirrors the source's unit to the destination when destination has no pre-existing balance (prevents unit mismatch between Transfer Out/In).

## Category uniqueness

`product_categories.name` has a `UNIQUE` constraint (enforced in schema + code). `create_category()` and `update_category()` in `ProductRepository` do a case-insensitive pre-check and raise `ValueError` (surfaced as HTTP 409) if the name already exists. Run `ALTER TABLE food_cost.product_categories ADD CONSTRAINT product_categories_name_unique UNIQUE (name)` on existing DBs.

## Invoice import — location assignment

`LineItemIn` now includes `location_id: int = 1`. The import flow requires a location per line item; the backend uses it for the `purchase_receipt` stock movement instead of the previous hardcoded `1`. `ImportRepository.suggest_locations(descriptions)` looks up each product by name in existing inventory and returns the location with highest balance, or `None` for unknown products. Exposed via `POST /import/suggest-locations`.

## Schema reference (key tables)

- `composite_products`: `product_type` ('composite'|'intermediate'), `is_archived`, full BOM via `composite_product_components`
- `recipe_yields`: links a composite product to its output product (`yield_product_id`) and quantity
- `production_batches`: records each batch run; `recipe_cost_snapshots` stores cost at time of production
- `stock_locations`, `stock_movements`, `inventory_balances`: ledger system
- `supplier_products.current_price`: used for recipe cost calculation (not `total_quantity_ordered`)
- `stock_count_sessions`: `count_date DATE`, `frozen_at` updated on creation and refresh. `refresh_lines()` re-syncs `system_qty` from `inventory_balances` for draft sessions — adds new products, updates quantities, preserves `counted_qty`.
- `products`: `units_per_pack` + `pack_unit_id` define wholesale↔retail conversion.
- `product_categories`: `name UNIQUE` — enforced at DB level and in `ProductRepository`. `is_service BOOLEAN DEFAULT FALSE` — when true, products in this category are excluded from inventory, stock count sessions, product stats, and category breakdown tiles; their invoice lines appear only in the Services & Guarantees page.
- `stock_count_category_nodes`: per-session category grouping (`session_id`, `category_id`, `display_order`). Managed via `get_count_categories()` / `set_count_categories()` in `StockCountRepository`.

## Product search query

`ProductRepository.search()` now uses a `DISTINCT ON` CTE (`preferred_supplier`) to pick one supplier per product, instead of a massive `GROUP BY` over 18 columns. The count query uses `EXISTS` for the supplier filter. `SORT_COLS` references `ps.*` (the CTE alias).

## Spend calculation — canonical pattern

All spend totals (dashboard, suppliers, invoices, purchases analytics) use **line-level sums** from `invoice_lines`, never invoice header amounts:

```sql
SUM(CASE WHEN i.invoice_type = 'invoice' THEN il.line_gross_amount ELSE -il.line_gross_amount END)
```

Credit notes have positive amounts stored in the DB; the CASE flips them negative. Invoice header columns (`gross_amount`, `net_amount`, `vat_amount`) may differ from line sums and must not be used for totals. `list_invoices()` now computes `net_amount`/`vat_amount`/`gross_amount` from line sums. Supplier stats (`list_suppliers`, `get_supplier`) also join `invoice_lines` for their totals.

## Row dict unpacking pitfall

PG wrapper rows are `dict` subclasses. Tuple unpacking (`for a, b, c in rows`) iterates dict **keys**, not values. Always unpack by key or integer index:
```python
# WRONG:  for _, sp_id, qty in rows:
# RIGHT:
for row in rows:
    sp_id = row["supplier_product_id"]
    qty   = row["quantity"]
```

## Service category exclusion pattern

Any query that should exclude service items must use:
```sql
LEFT JOIN product_categories pc ON pc.id = p.category_id
WHERE COALESCE(pc.is_service, FALSE) = FALSE
```
Applied in: `ProductRepository.search()` (main + count queries), `get_catalog_stats()`, `get_main_category_breakdown()` (`cat_root` CTE base case), `DashboardRepository._inventory_overview_rows()`, `StockCountRepository.create_session()`, `refresh_lines()`, `get_session()` (lines query).

## New/changed endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/products/reference-data` | GET | Batched data: `{categories, units, suppliers, stats, locations}` |
| `/products/{id}/cost-history` | GET | Invoice lines for a product ordered by date ASC (for cost history tab) |
| `/products/{id}` | DELETE | Delete a product with no invoice lines; checks invoice_lines + stock_movements first |
| `/inventory/{id}` | GET | Now includes `pack_unit_id`, `pack_unit`. Balances/`total_on_hand` normalised to retail units. |
| `/stock-count/sessions/{id}/refresh` | POST | Re-syncs `system_qty` from live inventory; draft-only |
| `/stock-count/sessions/{id}/categories` | GET/PUT | Get or replace the category-grouping nodes for a session |
| `/import/suggest-locations` | POST | `{descriptions: string[]}` → `{suggestions: (int\|null)[]}` — inventory-based location hints |
| `/purchases/analytics` | GET | `?granularity=day\|week\|month&months=0..36` — spend by period × category (0 = all time) |
| `/purchases/unmatched-lines` | GET | Invoice lines with no `supplier_product_id` (uncatalogued spend) |
| `/invoices/{id}` | PATCH | Edit invoice fields: `invoice_date`, `invoice_number`, `invoice_type`, `delivery_date`, `notes` |
| `/services/lines` | GET | Service invoice lines (`?category_id`, `supplier_id`, `date_from`, `date_to`). Returns `ServiceLineOut[]`. |

## Pending Supabase migrations (run once if not applied)

```sql
-- Add count_date to stock count sessions
ALTER TABLE food_cost.stock_count_sessions ADD COLUMN IF NOT EXISTS count_date DATE;

-- Allow receipt_pending movement type
ALTER TABLE food_cost.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;
ALTER TABLE food_cost.stock_movements ADD CONSTRAINT stock_movements_movement_type_check
    CHECK (movement_type IN ('purchase_receipt','adjustment_up','adjustment_down','waste',
        'transfer_out','transfer_in','production_consumption','production_output',
        'count_reconciliation','opening','receipt_pending'));

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_supplier_products_product_id ON food_cost.supplier_products(product_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_supplier_product_id ON food_cost.invoice_lines(supplier_product_id);
CREATE INDEX IF NOT EXISTS idx_price_history_supplier_product_id ON food_cost.price_history(supplier_product_id, effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_balances_product_id ON food_cost.inventory_balances(product_id);

-- Deduplicate categories and add unique constraint
WITH dupes AS (SELECT name, MIN(id) AS keep_id FROM food_cost.product_categories GROUP BY name HAVING COUNT(*) > 1)
UPDATE food_cost.products p SET category_id = d.keep_id
FROM food_cost.product_categories pc JOIN dupes d ON d.name = pc.name
WHERE p.category_id = pc.id AND p.category_id != d.keep_id;

WITH dupes AS (SELECT name, MIN(id) AS keep_id FROM food_cost.product_categories GROUP BY name HAVING COUNT(*) > 1)
UPDATE food_cost.product_categories child SET parent_id = d.keep_id
FROM food_cost.product_categories pc JOIN dupes d ON d.name = pc.name
WHERE child.parent_id = pc.id AND child.parent_id != d.keep_id;

WITH dupes AS (SELECT name, MIN(id) AS keep_id FROM food_cost.product_categories GROUP BY name HAVING COUNT(*) > 1)
DELETE FROM food_cost.product_categories pc USING dupes d WHERE pc.name = d.name AND pc.id != d.keep_id;

ALTER TABLE food_cost.product_categories ADD CONSTRAINT product_categories_name_unique UNIQUE (name);

-- Credit note support
ALTER TABLE food_cost.invoices ADD COLUMN IF NOT EXISTS invoice_type TEXT NOT NULL DEFAULT 'invoice'
    CHECK (invoice_type IN ('invoice', 'credit_note'));

ALTER TABLE food_cost.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;
ALTER TABLE food_cost.stock_movements ADD CONSTRAINT stock_movements_movement_type_check
    CHECK (movement_type IN ('purchase_receipt','adjustment_up','adjustment_down','waste',
        'transfer_out','transfer_in','production_consumption','production_output',
        'count_reconciliation','opening','receipt_pending','return_to_supplier'));

-- Backfill: fix total_quantity_ordered for already-imported credit notes
-- (code fix only applies to future imports; run this once to correct existing data)
UPDATE food_cost.supplier_products sp
SET total_quantity_ordered = COALESCE(sp.total_quantity_ordered, 0) - sub.total_credit_qty,
    updated_at = NOW()
FROM (
    SELECT il.supplier_product_id, SUM(il.quantity) AS total_credit_qty
    FROM food_cost.invoice_lines il
    JOIN food_cost.invoices i ON i.id = il.invoice_id
    WHERE i.invoice_type = 'credit_note'
      AND il.supplier_product_id IS NOT NULL
    GROUP BY il.supplier_product_id
) sub
WHERE sp.id = sub.supplier_product_id;

-- Stock count category grouping
CREATE TABLE IF NOT EXISTS food_cost.stock_count_category_nodes (
    id             SERIAL PRIMARY KEY,
    session_id     INTEGER NOT NULL REFERENCES food_cost.stock_count_sessions(id) ON DELETE CASCADE,
    category_id    INTEGER NOT NULL REFERENCES food_cost.product_categories(id),
    display_order  INTEGER NOT NULL DEFAULT 0,
    UNIQUE(session_id, category_id)
);

-- Service categories flag
ALTER TABLE food_cost.product_categories ADD COLUMN IF NOT EXISTS is_service BOOLEAN NOT NULL DEFAULT FALSE;
```

## Session Closing Protocol

When told to 'wrap up':
1. Update this file to reflect changes from the session (endpoints, schema, patterns). Keep under 300 lines.
2. Update `README.md` in the repo root if any user-facing features, setup steps, or architecture changed.
3. Stage all modified files: `git add <files>` (list files explicitly — never `git add -A`).
4. Write a concise commit message summarising what changed and why, then commit.
