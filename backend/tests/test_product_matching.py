"""Tests for product name similarity and SKU matching logic."""
import pytest
from app.domain.product_matching import names_similar
from app.services.import_service import import_invoice
from app.domain.units import build_unit_map


class TestNamesSimilar:
    def test_identical_names_match(self):
        assert names_similar("Red Bull 250ml", "Red Bull 250ml") is True

    def test_different_volume_still_matches(self):
        # volume tokens are stripped before comparison
        assert names_similar("Tanqueray Gin 700ml", "TANQUERAY GIN 1LT") is True

    def test_completely_different_names_no_match(self):
        assert names_similar("Vodka Premium", "Olive Oil Extra Virgin") is False

    def test_partial_overlap_below_threshold(self):
        assert names_similar("Blue Label Whiskey", "Red Wine Cabernet") is False

    def test_greek_names_match(self):
        assert names_similar("ΑΥΓΑ ΠΟΙΟΤΙΚΗΣ", "ΑΥΓΑ ΠΟΙΟΤΙΚΗ") is True

    def test_empty_string_matches_anything(self):
        assert names_similar("", "anything") is True
        assert names_similar("anything", "") is True


class TestSkuMatching:
    def test_sku_match_produces_warning_on_name_change(self, db, unit_map):
        """When SKU matches but product name differs significantly, a warning is emitted."""
        cur = db.cursor()
        # Seed a supplier and product
        cur.execute("INSERT INTO suppliers (name, vat_number) VALUES ('S', 'VXXX')")
        db.commit()
        supplier_id = cur.lastrowid
        cur.execute("INSERT INTO products (name, description) VALUES ('Old Name Vodka', 'desc')")
        db.commit()
        product_id = cur.lastrowid
        cur.execute("""
            INSERT INTO supplier_products
                (supplier_id, product_id, supplier_sku, current_price, total_quantity_ordered)
            VALUES (?, ?, 'SKU-TEST', 5.0, 0)
        """, (supplier_id, product_id))
        db.commit()

        inv = {
            "invoice_number": "INV-WARN",
            "invoice_date":   "2026-04-01",
            "supplier":       {"name": "S", "vat_number": "VXXX",
                               "trade_name": None, "phone": None, "address": None},
            "net_amount": 10, "vat_amount": 2.4, "excise_duty_amount": 0, "gross_amount": 12.4,
            "line_items": [{
                "supplier_sku":         "SKU-TEST",
                "description":          "Completely Different Product",
                "quantity":             2,
                "unit":                 "btl",
                "unit_price":           5.0,
                "discount_percent":     0,
                "line_net_amount":      10.0,
                "vat_rate":             24.0,
                "excise_duty_per_unit": 0,
                "line_gross_amount":    12.4,
            }],
        }
        _, warnings = import_invoice(cur, inv, unit_map)
        assert len(warnings) == 1
        assert "SKU-TEST" in warnings[0]["message"]
