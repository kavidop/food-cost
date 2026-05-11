def post_movements(
    db,
    entries: list[dict],
    *,
    allow_negative: bool = False,
    commit: bool = True,
) -> dict:
    """Append stock ledger entries and update denormalized balances.

    Entries must contain: product_id, location_id, movement_type, quantity.
    Optional fields: unit_id, reason, reference_id, reference_type, notes, moved_at.
    """
    if not entries:
        return {"success": True, "movement_ids": []}

    prepared: list[dict] = []
    balance_deltas: dict[tuple[int, int], float] = {}
    balance_qtys: dict[tuple[int, int], float] = {}
    balance_unit_ids: dict[tuple[int, int], int | None] = {}
    product_pack_info: dict[int, dict] = {}  # cached per product_id

    for raw in entries:
        qty = float(raw["quantity"])
        if abs(qty) < 0.0000001:
            continue

        product_id = int(raw["product_id"])
        location_id = int(raw["location_id"])
        key = (product_id, location_id)

        unit_id = raw.get("unit_id")
        if unit_id is None:
            row = db.execute(
                "SELECT unit_id FROM products WHERE id = %s", (product_id,)
            ).fetchone()
            if not row:
                raise ValueError(f"Product {product_id} not found")
            unit_id = row["unit_id"]

        if key not in balance_qtys:
            balance_row = db.execute(
                "SELECT COALESCE(quantity, 0) AS quantity, unit_id "
                "FROM inventory_balances WHERE product_id = %s AND location_id = %s",
                key,
            ).fetchone()
            balance_qtys[key] = float(balance_row["quantity"]) if balance_row else 0.0
            balance_unit_ids[key] = balance_row["unit_id"] if balance_row else None

        # Convert qty to the balance's native unit when they differ
        balance_unit = balance_unit_ids[key]
        balance_qty = qty
        if balance_unit is not None and balance_unit != unit_id:
            if product_id not in product_pack_info:
                prow = db.execute(
                    "SELECT pack_unit_id, units_per_pack FROM products WHERE id = %s",
                    (product_id,),
                ).fetchone()
                product_pack_info[product_id] = dict(prow) if prow else {}
            info = product_pack_info[product_id]
            upp = info.get("units_per_pack")
            puid = info.get("pack_unit_id")
            if upp and puid:
                if unit_id == puid:
                    # movement in pack units, balance in retail → multiply
                    balance_qty = qty * upp
                elif balance_unit == puid:
                    # movement in retail units, balance in pack → divide
                    balance_qty = qty / upp

        balance_deltas[key] = balance_deltas.get(key, 0.0) + balance_qty
        prepared.append({
            "product_id": product_id,
            "location_id": location_id,
            "movement_type": raw["movement_type"],
            "quantity": qty,
            "unit_id": unit_id,
            "reason": raw.get("reason"),
            "reference_id": raw.get("reference_id"),
            "reference_type": raw.get("reference_type"),
            "notes": raw.get("notes"),
            "moved_at": raw.get("moved_at"),
        })

    if not prepared:
        return {"success": True, "movement_ids": []}

    for key, bdelta in balance_deltas.items():
        current_qty = balance_qtys[key]
        resulting_qty = round(current_qty + bdelta, 6)
        if resulting_qty < 0 and not allow_negative:
            return {
                "success": False,
                "warning": "negative_stock",
                "current_stock": round(current_qty, 6),
                "resulting_stock": resulting_qty,
                "product_id": key[0],
                "location_id": key[1],
            }

    movement_ids: list[int] = []
    for item in prepared:
        cur = db.execute(
            """
            INSERT INTO stock_movements
                (product_id, location_id, movement_type, quantity, unit_id,
                 reason, reference_id, reference_type, notes, moved_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, COALESCE(%s, NOW()))
            """,
            (
                item["product_id"],
                item["location_id"],
                item["movement_type"],
                item["quantity"],
                item["unit_id"],
                item["reason"],
                item["reference_id"],
                item["reference_type"],
                item["notes"],
                item["moved_at"],
            ),
        )
        movement_ids.append(cur.lastrowid)

    for (product_id, location_id), bdelta in balance_deltas.items():
        key = (product_id, location_id)
        # Use existing balance unit; for new balances fall back to movement unit
        upsert_unit = balance_unit_ids.get(key) or next(
            item["unit_id"] for item in prepared
            if item["product_id"] == product_id and item["location_id"] == location_id
        )
        db.execute(
            """
            INSERT INTO inventory_balances (product_id, location_id, quantity, unit_id)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT(product_id, location_id) DO UPDATE SET
                quantity     = inventory_balances.quantity + excluded.quantity,
                last_updated = NOW()
            """,
            (product_id, location_id, bdelta, upsert_unit),
        )

    if commit:
        db.commit()

    return {"success": True, "movement_ids": movement_ids}
