import sqlite3
import pytest
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).parent.parent / "migrations"


def _apply_migrations(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA foreign_keys = ON")
    for f in sorted(MIGRATIONS_DIR.glob("*.sql")):
        conn.executescript(f.read_text(encoding="utf-8"))
    conn.commit()


@pytest.fixture
def db() -> sqlite3.Connection:
    """Fresh in-memory SQLite database with all migrations applied."""
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    _apply_migrations(conn)
    yield conn
    conn.close()


@pytest.fixture
def unit_map(db) -> dict:
    from app.domain.units import build_unit_map
    return build_unit_map(db.cursor())


@pytest.fixture
def seeded_db(db) -> sqlite3.Connection:
    """DB with one supplier, one product, and one invoice."""
    db.executescript("""
        INSERT INTO suppliers (id, name, vat_number)
        VALUES (1, 'Test Supplier', 'VAT001');

        INSERT INTO products (id, name, description, units_per_pack)
        VALUES (1, 'Test Product', 'Test Product', 1);

        INSERT INTO supplier_products
            (id, supplier_id, product_id, supplier_sku, current_price, total_quantity_ordered)
        VALUES (1, 1, 1, 'SKU001', 10.0, 5);

        INSERT INTO invoices
            (id, supplier_id, invoice_number, invoice_date,
             net_amount, vat_amount, excise_duty_amount, gross_amount)
        VALUES (1, 1, 'INV-001', '2026-01-01', 50.0, 12.0, 0.0, 62.0);

        INSERT INTO invoice_lines
            (invoice_id, supplier_product_id, line_description,
             quantity, unit_id, unit_price, discount_percent,
             line_net_amount, vat_rate, excise_duty_per_unit, line_gross_amount)
        VALUES (1, 1, 'Test Product', 5, 6, 10.0, 0, 50.0, 24.0, 0, 62.0);

        INSERT INTO price_history
            (supplier_product_id, unit_price, vat_rate, excise_duty_per_unit, effective_from, invoice_id)
        VALUES (1, 10.0, 24.0, 0, '2026-01-01', 1);
    """)
    db.commit()
    return db
