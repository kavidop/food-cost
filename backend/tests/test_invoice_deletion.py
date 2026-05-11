"""Tests for invoice deletion logic: cascades, exclusive product cleanup."""
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.database import get_db


def make_client(db_conn):
    def override():
        yield db_conn
    app.dependency_overrides[get_db] = override
    client = TestClient(app)
    yield client
    app.dependency_overrides.clear()


@pytest.fixture
def client(seeded_db):
    yield from make_client(seeded_db)


def test_delete_invoice_removes_lines(client, seeded_db):
    resp = client.delete("/api/invoices/1")
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["lines_deleted"] >= 1


def test_delete_invoice_removes_exclusive_product(client, seeded_db):
    """Product that only appears on the deleted invoice should be purged."""
    resp = client.delete("/api/invoices/1")
    assert resp.status_code == 200
    assert resp.json()["products_deleted"] >= 1

    product = seeded_db.execute("SELECT * FROM products WHERE id=1").fetchone()
    assert product is None


def test_delete_invoice_keeps_shared_product(client, seeded_db):
    """Product shared across two invoices must survive deletion of one invoice."""
    cur = seeded_db.cursor()
    # Add a second invoice referencing the same supplier_product (id=1)
    cur.execute("""
        INSERT INTO invoices
            (supplier_id, invoice_number, invoice_date,
             net_amount, vat_amount, excise_duty_amount, gross_amount)
        VALUES (1, 'INV-002', '2026-02-01', 50.0, 12.0, 0.0, 62.0)
    """)
    inv2_id = cur.lastrowid
    cur.execute("""
        INSERT INTO invoice_lines
            (invoice_id, supplier_product_id, line_description,
             quantity, unit_id, unit_price, discount_percent,
             line_net_amount, vat_rate, excise_duty_per_unit, line_gross_amount)
        VALUES (?, 1, 'Test Product', 3, 6, 10.0, 0, 30.0, 24.0, 0, 37.2)
    """, (inv2_id,))
    seeded_db.commit()

    resp = client.delete("/api/invoices/1")
    assert resp.status_code == 200

    # Product 1 must still exist because it appears on INV-002
    product = seeded_db.execute("SELECT * FROM products WHERE id=1").fetchone()
    assert product is not None


def test_delete_nonexistent_invoice_returns_404(client):
    resp = client.delete("/api/invoices/99999")
    assert resp.status_code == 404


def test_delete_invoice_nullifies_price_history(client, seeded_db):
    resp = client.delete("/api/invoices/1")
    assert resp.status_code == 200
    # price_history rows that referenced this invoice should be NULL or removed
    row = seeded_db.execute(
        "SELECT * FROM price_history WHERE invoice_id=1"
    ).fetchone()
    assert row is None


def test_delete_invoice_removes_receipt_movements_and_rebuilds_balance(client, seeded_db):
    line_id = seeded_db.execute(
        "SELECT id FROM invoice_lines WHERE invoice_id=1"
    ).fetchone()[0]

    seeded_db.execute(
        """
        INSERT INTO stock_movements
            (product_id, location_id, movement_type, quantity, unit_id,
             reference_id, reference_type, moved_at)
        VALUES (1, 1, 'purchase_receipt', 5, 6, ?, 'invoice_line', '2026-01-01')
        """,
        (line_id,),
    )
    seeded_db.execute(
        "INSERT INTO inventory_balances (product_id, location_id, quantity, unit_id) VALUES (1, 1, 5, 6)"
    )
    seeded_db.commit()

    resp = client.delete('/api/invoices/1')
    assert resp.status_code == 200

    movement = seeded_db.execute(
        "SELECT id FROM stock_movements WHERE reference_type='invoice_line' AND reference_id=?",
        (line_id,),
    ).fetchone()
    assert movement is None

    balance = seeded_db.execute(
        "SELECT id FROM inventory_balances WHERE product_id=1 AND location_id=1"
    ).fetchone()
    assert balance is None


def test_delete_invoice_does_not_crash_when_product_has_other_references(client, seeded_db):
    seeded_db.execute(
        """
        INSERT INTO stock_movements
            (product_id, location_id, movement_type, quantity, unit_id,
             reference_id, reference_type, moved_at)
        VALUES (1, 1, 'adjustment_up', 2, 6, 99, 'manual_adjustment', '2026-01-02')
        """
    )
    seeded_db.execute(
        "INSERT INTO inventory_balances (product_id, location_id, quantity, unit_id) VALUES (1, 1, 2, 6)"
    )
    seeded_db.commit()

    resp = client.delete('/api/invoices/1')
    assert resp.status_code == 200
    assert resp.json()['success'] is True

    product = seeded_db.execute("SELECT * FROM products WHERE id=1").fetchone()
    assert product is not None
