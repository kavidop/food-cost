"""Tests for composite product / recipe cost calculation."""
import pytest
from app.services.recipe_service import calc_composite


@pytest.fixture
def recipe_db(db):
    """DB with two products and a recipe using both."""
    db.executescript("""
        INSERT INTO suppliers (id, name, vat_number) VALUES (1, 'S', 'VRECIPE');

        INSERT INTO products (id, name, units_per_pack) VALUES (1, 'Vodka', 1);
        INSERT INTO products (id, name, units_per_pack) VALUES (2, 'Lime Juice', 1);

        INSERT INTO supplier_products
            (id, supplier_id, product_id, supplier_sku, current_price, total_quantity_ordered)
        VALUES (1, 1, 1, 'V001', 10.0, 20);

        INSERT INTO supplier_products
            (id, supplier_id, product_id, supplier_sku, current_price, total_quantity_ordered)
        VALUES (2, 1, 2, 'L001', 5.0, 15);

        INSERT INTO inventory_balances (product_id, location_id, quantity) VALUES (1, 1, 20);
        INSERT INTO inventory_balances (product_id, location_id, quantity) VALUES (2, 1, 15);

        INSERT INTO composite_products (id, name, selling_price, servings)
        VALUES (1, 'Moscow Mule', 12.0, 1);

        INSERT INTO composite_product_components
            (composite_product_id, component_product_id, quantity, unit)
        VALUES (1, 1, 0.05, 'L');   -- 50ml vodka

        INSERT INTO composite_product_components
            (composite_product_id, component_product_id, quantity, unit)
        VALUES (1, 2, 0.02, 'L');   -- 20ml lime juice
    """)
    db.commit()
    return db


def test_total_food_cost(recipe_db):
    result = calc_composite(recipe_db.cursor(), 1)
    # vodka: 0.05 * 10 = 0.5; lime: 0.02 * 5 = 0.10 → total = 0.60
    assert result["total_food_cost"] == pytest.approx(0.60, abs=0.001)


def test_component_count(recipe_db):
    result = calc_composite(recipe_db.cursor(), 1)
    assert len(result["components"]) == 2


def test_max_producible(recipe_db):
    result = calc_composite(recipe_db.cursor(), 1)
    # vodka: stock=20, need=0.05 → 400; lime: stock=15, need=0.02 → 750
    # bottleneck is vodka at 400
    assert result["max_producible"] == 400


def test_bottleneck_identification(recipe_db):
    result = calc_composite(recipe_db.cursor(), 1)
    assert result["bottleneck"] == "Vodka"


def test_empty_recipe_returns_zero_cost(db):
    db.execute("INSERT INTO composite_products (id, name, servings) VALUES (99, 'Empty', 1)")
    db.commit()
    result = calc_composite(db.cursor(), 99)
    assert result["total_food_cost"] == 0.0
    assert result["max_producible"] == 0
    assert result["bottleneck"] is None
    assert result["components"] == []


def test_unit_cost_divides_by_units_per_pack(db):
    """When units_per_pack=6 (case), unit cost = price / 6."""
    db.executescript("""
        INSERT INTO suppliers (id, name, vat_number) VALUES (10, 'S10', 'V10');
        INSERT INTO products (id, name, units_per_pack) VALUES (10, 'Beer Case', 6);
        INSERT INTO supplier_products (id, supplier_id, product_id, supplier_sku, current_price, total_quantity_ordered)
        VALUES (10, 10, 10, 'B001', 12.0, 2);
        INSERT INTO inventory_balances (product_id, location_id, quantity) VALUES (10, 1, 2);
        INSERT INTO composite_products (id, name, servings) VALUES (10, 'Beer Cocktail', 1);
        INSERT INTO composite_product_components (composite_product_id, component_product_id, quantity, unit)
        VALUES (10, 10, 1, 'pcs');
    """)
    db.commit()
    result = calc_composite(db.cursor(), 10)
    assert result["components"][0]["unit_cost"] == pytest.approx(2.0, abs=0.001)  # 12 / 6
