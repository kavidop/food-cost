"""Verify that all SQL migration files apply cleanly and produce the expected schema."""
import sqlite3
from pathlib import Path

import pytest

MIGRATIONS_DIR = Path(__file__).parent.parent / "migrations"

# Every table that must exist after all migrations have been applied.
EXPECTED_TABLES = {
    "suppliers",
    "product_categories",
    "units_of_measure",
    "products",
    "supplier_products",
    "invoices",
    "invoice_lines",
    "price_history",
    "composite_products",
    "composite_product_components",
    # inventory (migration 005)
    "stock_locations",
    "stock_movements",
    "inventory_balances",
    "stock_count_sessions",
    "stock_count_lines",
    # costing & production (migration 006)
    "unit_conversions",
    "production_batches",
    "recipe_yields",
    "recipe_cost_snapshots",
    # products extended (migration 007) — no new table, just a column
}


def _migration_files() -> list[Path]:
    return sorted(
        f for f in MIGRATIONS_DIR.glob("*.sql") if f.stem[0].isdigit()
    )


def _fresh_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _apply_all(conn: sqlite3.Connection) -> None:
    for f in _migration_files():
        conn.executescript(f.read_text(encoding="utf-8"))
    conn.commit()


# ── file-level invariants (no DB needed) ──────────────────────────────────────

def test_at_least_one_migration_file_exists():
    assert len(_migration_files()) >= 1


def test_migration_versions_are_unique():
    versions = [int(f.stem.split("_")[0]) for f in _migration_files()]
    assert len(versions) == len(set(versions)), "Duplicate migration version numbers found"


def test_migration_versions_are_sequential():
    versions = [int(f.stem.split("_")[0]) for f in _migration_files()]
    assert versions == list(range(1, len(versions) + 1)), (
        "Migration versions are not sequential (gaps or wrong start)"
    )


# ── apply-to-fresh-DB tests ───────────────────────────────────────────────────

def test_all_migrations_apply_to_blank_db():
    """Applying every migration to a blank in-memory DB raises no exception."""
    conn = _fresh_conn()
    _apply_all(conn)
    conn.close()


def test_all_expected_tables_exist_after_migrations():
    conn = _fresh_conn()
    _apply_all(conn)
    tables = {
        r["name"]
        for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    conn.close()
    for table in EXPECTED_TABLES:
        assert table in tables, f"Expected table '{table}' missing after migrations"


def test_migrations_are_idempotent():
    """Running every migration twice on the same DB must not raise errors.

    All DDL uses CREATE TABLE IF NOT EXISTS and seed INSERTs use OR IGNORE,
    so a second pass should be a no-op.
    """
    conn = _fresh_conn()
    _apply_all(conn)
    _apply_all(conn)   # second pass
    conn.close()


def test_units_of_measure_seeded():
    """Standard units must be present after migrations (seeded in 001)."""
    conn = _fresh_conn()
    _apply_all(conn)
    abbreviations = {
        r[0]
        for r in conn.execute("SELECT abbreviation FROM units_of_measure").fetchall()
    }
    conn.close()
    for expected in ("btl", "cs", "kg", "L", "can", "pcs", "kbt"):
        assert expected in abbreviations, f"Unit '{expected}' missing after migrations"


def test_product_categories_seeded():
    """Reference categories must be present after migrations (seeded in 004)."""
    conn = _fresh_conn()
    _apply_all(conn)
    count = conn.execute("SELECT COUNT(*) FROM product_categories").fetchone()[0]
    conn.close()
    assert count > 0, "No product categories found after migrations"


def test_default_stock_location_seeded():
    """Migration 005 must seed a 'Main' location with id=1."""
    conn = _fresh_conn()
    _apply_all(conn)
    row = conn.execute(
        "SELECT id, name FROM stock_locations WHERE id = 1"
    ).fetchone()
    conn.close()
    assert row is not None, "Default stock location (id=1) missing after migrations"
    assert row[0] == 1
    assert row[1] == 'Main'


def test_inventory_balance_created_by_import(db):
    """import_invoice must write an inventory_balance row for each purchased product."""
    from app.services.import_service import import_invoice
    from app.domain.units import build_unit_map

    unit_map = build_unit_map(db.cursor())
    invoice = {
        "supplier": {"name": "Test Sup", "trade_name": None,
                     "vat_number": "VATINV001", "phone": None, "address": None},
        "invoice_number": "INV-BAL-001",
        "invoice_date": "2026-01-01",
        "net_amount": 10.0, "vat_amount": 2.4,
        "excise_duty_amount": 0.0, "gross_amount": 12.4,
        "line_items": [{
            "description": "Test Spirit",
            "supplier_sku": "TS001",
            "quantity": 3,
            "unit": "btl",
            "unit_price": 10.0,
            "discount_percent": 0,
            "line_net_amount": 30.0,
            "vat_rate": 24.0,
            "excise_duty_per_unit": 0.0,
            "line_gross_amount": 37.2,
        }],
    }
    import_invoice(db.cursor(), invoice, unit_map)
    db.commit()

    row = db.execute(
        "SELECT ib.quantity FROM inventory_balances ib "
        "JOIN products p ON p.id = ib.product_id "
        "WHERE p.name = 'Test Spirit'"
    ).fetchone()
    assert row is not None, "No inventory_balance row created by import_invoice"
    assert row[0] == 3, f"Expected balance 3, got {row[0]}"


def test_composite_product_components_allows_null_product_id():
    """Migration 003 must allow component_product_id to be NULL (composite sub-components)."""
    conn = _fresh_conn()
    _apply_all(conn)
    # Insert a composite product and a component that references another composite,
    # leaving component_product_id NULL.
    conn.execute(
        "INSERT INTO composite_products (id, name, servings) VALUES (1, 'Parent', 1)"
    )
    conn.execute(
        "INSERT INTO composite_products (id, name, servings) VALUES (2, 'Child', 1)"
    )
    conn.execute("""
        INSERT INTO composite_product_components
            (composite_product_id, component_product_id, component_composite_id, quantity)
        VALUES (1, NULL, 2, 0.5)
    """)
    conn.commit()
    conn.close()
