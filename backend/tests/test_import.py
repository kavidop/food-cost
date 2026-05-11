"""Tests for invoice import: supplier upsert, product creation, price updates."""
import pytest
from app.services.import_service import import_invoice, build_unit_map

INVOICE_NEW = {
    "invoice_number": "INV-NEW",
    "invoice_date":   "2026-03-01",
    "supplier": {
        "name":       "Fresh Supplier",
        "trade_name": "Fresh",
        "vat_number": "VAT999",
        "phone":      None,
        "address":    None,
    },
    "net_amount":         100.0,
    "vat_amount":         24.0,
    "excise_duty_amount": 0.0,
    "gross_amount":       124.0,
    "line_items": [
        {
            "supplier_sku":        "SKU-A",
            "description":         "New Widget",
            "quantity":            10,
            "unit":                "pcs",
            "unit_price":          10.0,
            "discount_percent":    0,
            "line_net_amount":     100.0,
            "vat_rate":            24.0,
            "excise_duty_per_unit":0,
            "line_gross_amount":   124.0,
        }
    ],
}


def test_import_creates_new_supplier(db, unit_map):
    cur = db.cursor()
    import_invoice(cur, INVOICE_NEW, unit_map)
    db.commit()

    row = db.execute("SELECT * FROM suppliers WHERE vat_number='VAT999'").fetchone()
    assert row is not None
    assert row["name"] == "Fresh Supplier"


def test_import_creates_new_product(db, unit_map):
    cur = db.cursor()
    import_invoice(cur, INVOICE_NEW, unit_map)
    db.commit()

    row = db.execute("SELECT * FROM products WHERE name='New Widget'").fetchone()
    assert row is not None


def test_import_creates_supplier_product_with_sku(db, unit_map):
    cur = db.cursor()
    import_invoice(cur, INVOICE_NEW, unit_map)
    db.commit()

    row = db.execute("SELECT * FROM supplier_products WHERE supplier_sku='SKU-A'").fetchone()
    assert row is not None
    assert row["current_price"] == 10.0
    assert row["total_quantity_ordered"] == 10


def test_import_updates_existing_product_price(db, unit_map):
    """Re-importing same SKU updates price and accumulates quantity."""
    cur = db.cursor()
    import_invoice(cur, INVOICE_NEW, unit_map)
    db.commit()

    updated = dict(INVOICE_NEW)
    updated["invoice_number"] = "INV-NEW-2"
    updated["line_items"][0]["unit_price"] = 12.0
    updated["line_items"][0]["quantity"]   = 5

    import_invoice(cur, updated, unit_map)
    db.commit()

    row = db.execute("SELECT * FROM supplier_products WHERE supplier_sku='SKU-A'").fetchone()
    assert row["current_price"] == 12.0
    assert row["total_quantity_ordered"] == 15  # 10 + 5


def test_import_existing_supplier_upserts(db, unit_map, seeded_db):
    """Importing against an existing VAT number updates supplier info."""
    cur = db.cursor()
    inv = dict(INVOICE_NEW)
    inv["invoice_number"] = "INV-UPSERT"
    inv["supplier"]["vat_number"] = "VAT001"  # existing
    inv["supplier"]["name"]       = "Updated Name"

    import_invoice(cur, inv, unit_map)
    db.commit()

    row = db.execute("SELECT name FROM suppliers WHERE vat_number='VAT001'").fetchone()
    assert row["name"] == "Updated Name"


def test_import_no_sku_creates_product(db, unit_map):
    """A line item with no SKU should still create a product matched by name."""
    cur = db.cursor()
    inv = {
        "invoice_number":    "INV-NOSKU",
        "invoice_date":      "2026-03-15",
        "supplier":          {"name": "NoSKU Supplier", "vat_number": "VAT-NOSKU",
                              "trade_name": None, "phone": None, "address": None},
        "net_amount": 20, "vat_amount": 4.8, "excise_duty_amount": 0, "gross_amount": 24.8,
        "line_items": [{
            "supplier_sku": None, "description": "Eggs Grade A",
            "quantity": 10, "unit": "pcs", "unit_price": 2.0,
            "discount_percent": 0, "line_net_amount": 20.0,
            "vat_rate": 24.0, "excise_duty_per_unit": 0, "line_gross_amount": 24.8,
        }],
    }
    import_invoice(cur, inv, unit_map)
    db.commit()

    row = db.execute("SELECT * FROM products WHERE name='Eggs Grade A'").fetchone()
    assert row is not None

    sp = db.execute("SELECT * FROM supplier_products WHERE supplier_sku IS NULL").fetchone()
    assert sp is not None
    assert sp["current_price"] == 2.0


def test_import_no_sku_deduplicates_by_name(db, unit_map):
    """Importing the same no-SKU product twice accumulates quantity, not creates duplicate."""
    cur = db.cursor()
    base_inv = {
        "invoice_number":    "INV-NOSKU-1",
        "invoice_date":      "2026-03-15",
        "supplier":          {"name": "NoSKU Supplier", "vat_number": "VAT-NOSKU2",
                              "trade_name": None, "phone": None, "address": None},
        "net_amount": 20, "vat_amount": 4.8, "excise_duty_amount": 0, "gross_amount": 24.8,
        "line_items": [{
            "supplier_sku": None, "description": "Eggs Grade A",
            "quantity": 10, "unit": "pcs", "unit_price": 2.0,
            "discount_percent": 0, "line_net_amount": 20.0,
            "vat_rate": 24.0, "excise_duty_per_unit": 0, "line_gross_amount": 24.8,
        }],
    }
    import_invoice(cur, base_inv, unit_map)
    db.commit()

    second = dict(base_inv)
    second["invoice_number"] = "INV-NOSKU-2"
    import_invoice(cur, second, unit_map)
    db.commit()

    count = db.execute("SELECT COUNT(*) FROM products WHERE name='Eggs Grade A'").fetchone()[0]
    assert count == 1

    sp = db.execute("SELECT total_quantity_ordered FROM supplier_products WHERE supplier_sku IS NULL").fetchone()
    assert sp["total_quantity_ordered"] == 20
