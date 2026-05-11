"""Tests for the shared inventory posting service."""
from app.services.inventory_posting_service import post_movements


def test_post_movements_appends_ledger_and_updates_balance(db):
    db.executescript("""
        INSERT INTO products (id, name, unit_id) VALUES (1, 'Milk', 4);
        INSERT INTO inventory_balances (product_id, location_id, quantity, unit_id)
        VALUES (1, 1, 5, 4);
    """)
    db.commit()

    result = post_movements(db, [{
        "product_id": 1,
        "location_id": 1,
        "movement_type": "adjustment_down",
        "quantity": -2,
        "reason": "test",
        "notes": "adjust for test",
    }])

    assert result["success"] is True
    assert len(result["movement_ids"]) == 1

    movement = db.execute(
        "SELECT movement_type, quantity, reason, notes FROM stock_movements WHERE id = ?",
        (result["movement_ids"][0],),
    ).fetchone()
    assert movement["movement_type"] == "adjustment_down"
    assert movement["quantity"] == -2
    assert movement["reason"] == "test"
    assert movement["notes"] == "adjust for test"

    balance = db.execute(
        "SELECT quantity FROM inventory_balances WHERE product_id = 1 AND location_id = 1"
    ).fetchone()[0]
    assert balance == 3


def test_post_movements_rejects_negative_stock_without_writing(db):
    db.executescript("""
        INSERT INTO products (id, name, unit_id) VALUES (1, 'Milk', 4);
        INSERT INTO inventory_balances (product_id, location_id, quantity, unit_id)
        VALUES (1, 1, 1, 4);
    """)
    db.commit()

    result = post_movements(db, [{
        "product_id": 1,
        "location_id": 1,
        "movement_type": "waste",
        "quantity": -2,
        "reason": "expired",
    }])

    assert result["success"] is False
    assert result["warning"] == "negative_stock"
    assert result["current_stock"] == 1.0
    assert result["resulting_stock"] == -1.0

    movement_count = db.execute("SELECT COUNT(*) FROM stock_movements").fetchone()[0]
    assert movement_count == 0

    balance = db.execute(
        "SELECT quantity FROM inventory_balances WHERE product_id = 1 AND location_id = 1"
    ).fetchone()[0]
    assert balance == 1


def test_post_movements_validates_batch_effects_across_entries(db):
    db.executescript("""
        INSERT INTO products (id, name, unit_id) VALUES (1, 'Milk', 4);
        INSERT INTO inventory_balances (product_id, location_id, quantity, unit_id)
        VALUES (1, 1, 3, 4);
    """)
    db.commit()

    result = post_movements(db, [
        {
            "product_id": 1,
            "location_id": 1,
            "movement_type": "adjustment_down",
            "quantity": -2,
        },
        {
            "product_id": 1,
            "location_id": 1,
            "movement_type": "waste",
            "quantity": -2,
        },
    ])

    assert result["success"] is False
    assert result["current_stock"] == 3.0
    assert result["resulting_stock"] == -1.0

    movement_count = db.execute("SELECT COUNT(*) FROM stock_movements").fetchone()[0]
    assert movement_count == 0
