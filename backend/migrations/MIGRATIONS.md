# Migration Conventions

## File naming

```
NNN_short_description.sql
```

- `NNN` — zero-padded integer, starting at `001`, incrementing by 1 with no gaps.
- `short_description` — snake_case, concise, describes the change (e.g. `add_composite_products`).

Examples: `001_initial.sql`, `002_composite_products.sql`, `003_composite_ingredient.sql`

## Runner behaviour (`migrations/runner.py`)

1. On startup, the runner bootstraps the `schema_migrations` tracking table (the only schema
   object it creates outside a `.sql` file — unavoidable chicken-and-egg).
2. It scans `*.sql` files sorted numerically, skips already-applied versions, and applies
   new ones in order.
3. Each file is applied with `executescript`, so a file may contain multiple statements.
4. After applying a file its version is recorded in `schema_migrations`.

## Rules for writing migration files

| Rule | Reason |
|------|--------|
| Use `CREATE TABLE IF NOT EXISTS` | Lets the runner re-apply on a fresh DB without errors; makes migrations idempotent. |
| Use `INSERT OR IGNORE` for seed data | Same idempotency guarantee. |
| Never DROP or rename a column | SQLite requires table recreation; write a new migration that recreates the table. |
| One logical change per file | Makes rollback reasoning easier (even though we don't automate rollbacks). |
| Never skip a version number | The runner sorts numerically; gaps would silently leave applied versions out of order. |
| No schema DDL outside `.sql` files | All `CREATE TABLE`, `ALTER TABLE`, `DROP TABLE` belongs here. Python code must not contain DDL. |

## What belongs in migrations vs elsewhere

| Belongs in migrations | Does NOT belong here |
|-----------------------|----------------------|
| `CREATE TABLE` / `ALTER TABLE` | Application logic (Python) |
| Reference / taxonomy seed data (units, categories) | Environment-specific fixtures (dev products, test invoices) |
| Constraint or index changes | Anything that changes between environments |

## Adding a new migration

1. Pick the next version number: `max(existing) + 1`.
2. Create `NNN_description.sql` in this directory.
3. Write idempotent SQL (use `IF NOT EXISTS`, `OR IGNORE`, etc.).
4. Run the backend — the runner will apply it on the next startup.
5. Commit the `.sql` file alongside any Python code that depends on the new schema.

## Checking migration status

```bash
sqlite3 zubro_food_cost.db "SELECT * FROM schema_migrations ORDER BY version;"
```
