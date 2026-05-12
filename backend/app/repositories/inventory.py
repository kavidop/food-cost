import csv
import io

from fastapi import Depends

from ..database import get_db
from ..protocols import DBConnection
from ..services.inventory_posting_service import post_movements


class InventoryRepository:
    def __init__(self, db: DBConnection) -> None:
        self.db = db

    def get_locations(self) -> list[dict]:
        return [dict(r) for r in self.db.execute(
            "SELECT id, name, sort_order, is_active FROM stock_locations ORDER BY sort_order, name"
        ).fetchall()]

    def create_location(self, name: str, sort_order: int) -> dict:
        cur = self.db.execute(
            "INSERT INTO stock_locations (name, sort_order, is_active) VALUES (%s, %s, 1)",
            (name.strip(), sort_order),
        )
        self.db.commit()
        row = self.db.execute(
            "SELECT id, name, sort_order, is_active FROM stock_locations WHERE id = %s",
            (cur.lastrowid,),
        ).fetchone()
        return dict(row)

    def update_location(
        self,
        location_id: int,
        name: str | None,
        sort_order: int | None,
        is_active: int | None,
    ) -> dict | None:
        row = self.db.execute(
            "SELECT id, name, sort_order, is_active FROM stock_locations WHERE id = %s",
            (location_id,),
        ).fetchone()
        if not row:
            return None
        new_name       = name.strip()  if name       is not None else row["name"]
        new_sort_order = sort_order    if sort_order  is not None else row["sort_order"]
        new_is_active  = is_active     if is_active   is not None else row["is_active"]
        self.db.execute(
            "UPDATE stock_locations SET name = %s, sort_order = %s, is_active = %s WHERE id = %s",
            (new_name, new_sort_order, new_is_active, location_id),
        )
        self.db.commit()
        return dict(self.db.execute(
            "SELECT id, name, sort_order, is_active FROM stock_locations WHERE id = %s",
            (location_id,),
        ).fetchone())

    def get_overview(
        self,
        location_id: int | None = None,
        category_id: int | None = None,
        supplier_id: int | None = None,
        low_stock_only: bool = False,
        include_inactive: bool = False,
    ) -> list[dict]:
        params: list = []

        if location_id:
            balance_join = (
                "JOIN inventory_balances ib "
                "ON ib.product_id = p.id AND ib.location_id = %s"
            )
            params.append(location_id)
        else:
            balance_join = """
                LEFT JOIN (
                    SELECT product_id, SUM(quantity) AS quantity, NULL::integer AS unit_id
                    FROM inventory_balances
                    GROUP BY product_id
                ) ib ON ib.product_id = p.id
            """

        where: list[str] = ["COALESCE(pc.is_service, FALSE) = FALSE"]
        if not include_inactive:
            where.append("p.is_active = 1")
        if category_id:
            where.append("p.category_id = %s")
            params.append(category_id)
        if supplier_id:
            where.append(
                "EXISTS (SELECT 1 FROM supplier_products sp_f "
                "WHERE sp_f.product_id = p.id AND sp_f.supplier_id = %s)"
            )
            params.append(supplier_id)

        sql = f"""
            SELECT
                p.id                            AS product_id,
                p.name                          AS product_name,
                pc.name                         AS category,
                pc.id                           AS category_id,
                COALESCE(ib.quantity, 0)        AS on_hand_qty,
                ib.unit_id                      AS balance_unit_id,
                uom.abbreviation                AS unit,
                uom.id                          AS unit_id,
                p.units_per_pack                AS units_per_pack,
                p.pack_unit_id                  AS pack_unit_id,
                p.min_stock_level               AS min_stock_level,
                p.is_active                     AS is_active,
                COALESCE((
                    SELECT ph.unit_price
                    FROM price_history ph
                    JOIN supplier_products sp2 ON sp2.id = ph.supplier_product_id
                    WHERE sp2.product_id = p.id
                    ORDER BY ph.effective_from DESC, ph.id DESC
                    LIMIT 1
                ), (
                    SELECT sp5.current_price
                    FROM supplier_products sp5
                    WHERE sp5.product_id = p.id
                    ORDER BY sp5.is_preferred_supplier DESC, sp5.current_price ASC
                    LIMIT 1
                )) AS latest_cost,
                COALESCE((
                    SELECT ROUND(
                        (SUM(il.quantity * il.unit_price) / NULLIF(SUM(il.quantity), 0))
                    ::numeric, 4)
                    FROM invoice_lines il
                    JOIN supplier_products sp3 ON sp3.id = il.supplier_product_id
                    WHERE sp3.product_id = p.id AND il.quantity > 0
                ), (
                    SELECT sp5.current_price
                    FROM supplier_products sp5
                    WHERE sp5.product_id = p.id
                    ORDER BY sp5.is_preferred_supplier DESC, sp5.current_price ASC
                    LIMIT 1
                )) AS weighted_avg_cost,
                (
                    SELECT s.name
                    FROM supplier_products sp4
                    JOIN suppliers s ON s.id = sp4.supplier_id
                    WHERE sp4.product_id = p.id AND sp4.is_preferred_supplier = 1
                    ORDER BY sp4.id LIMIT 1
                ) AS preferred_supplier,
                (
                    SELECT sp4.supplier_id
                    FROM supplier_products sp4
                    WHERE sp4.product_id = p.id AND sp4.is_preferred_supplier = 1
                    ORDER BY sp4.id LIMIT 1
                ) AS preferred_supplier_id,
                EXISTS (
                    SELECT 1 FROM stock_movements sm_pr
                    WHERE sm_pr.product_id = p.id
                      AND sm_pr.movement_type = 'receipt_pending'
                      AND sm_pr.reference_id IS NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM stock_movements sv
                          WHERE sv.reference_type = 'void' AND sv.reference_id = sm_pr.id
                      )
                ) AS has_pending_receipt
            FROM products p
            LEFT JOIN product_categories pc ON pc.id = p.category_id
            LEFT JOIN units_of_measure uom ON uom.id = p.unit_id
            {balance_join}
            WHERE {' AND '.join(where)}
            ORDER BY p.name
        """

        rows = [dict(r) for r in self.db.execute(sql, params).fetchall()]
        result = []

        for row in rows:
            qty   = row["on_hand_qty"]
            min_l = row.get("min_stock_level")
            wac   = row["weighted_avg_cost"]
            lc    = row["latest_cost"]
            cost  = wac if wac is not None else (lc if lc is not None else 0.0)

            if qty < 0:
                status = "negative"
            elif qty == 0:
                status = "out_of_stock"
            elif min_l is not None and qty <= min_l:
                status = "low_stock"
            else:
                status = "ok"

            row["stock_status"]       = status
            upp = row.get("units_per_pack")
            bal_unit = row.get("balance_unit_id")
            pack_unit = row.get("pack_unit_id")
            retail_qty = qty
            if upp and bal_unit is not None and pack_unit is not None and bal_unit == pack_unit:
                retail_qty = qty * upp
            pack_qty = retail_qty / upp if upp and upp > 1 else retail_qty
            row["stock_value"]        = round(pack_qty * cost, 4) if cost else 0.0
            row["missing_cost"]       = lc is None and wac is None
            row["missing_conversion"] = False

            if low_stock_only and status not in ("low_stock", "negative", "out_of_stock"):
                continue

            result.append(row)

        return result

    def get_product_detail(self, product_id: int) -> dict | None:
        row = self.db.execute("""
            SELECT p.id, p.name, p.description, p.is_active, p.min_stock_level,
                   p.units_per_pack,
                   pc.id AS category_id, pc.name AS category,
                   uom.id AS unit_id, uom.abbreviation AS unit,
                   p.pack_unit_id,
                   puom.abbreviation AS pack_unit
            FROM products p
            LEFT JOIN product_categories pc ON pc.id = p.category_id
            LEFT JOIN units_of_measure uom  ON uom.id = p.unit_id
            LEFT JOIN units_of_measure puom ON puom.id = p.pack_unit_id
            WHERE p.id = %s
        """, (product_id,)).fetchone()
        if not row:
            return None
        detail = dict(row)

        balances = [dict(r) for r in self.db.execute("""
            SELECT sl.id AS location_id, sl.name AS location_name,
                   ib.quantity, ib.unit_id,
                   uom.abbreviation AS unit
            FROM inventory_balances ib
            JOIN stock_locations sl ON sl.id = ib.location_id
            LEFT JOIN units_of_measure uom ON uom.id = ib.unit_id
            WHERE ib.product_id = %s
            ORDER BY sl.sort_order, sl.name
        """, (product_id,)).fetchall()]

        # Normalise each balance to retail units (convert from pack if needed)
        units_per_pack = detail.get("units_per_pack")
        pack_unit_id   = detail.get("pack_unit_id")
        retail_unit_id = detail.get("unit_id")
        for b in balances:
            if units_per_pack and b["unit_id"] == pack_unit_id:
                b["quantity"] = b["quantity"] * units_per_pack
                b["unit"] = detail["unit"]
            elif b.get("unit_id") != retail_unit_id:
                # Balance was recorded under a previous unit; show current product unit
                b["unit"] = detail["unit"]
            b.pop("unit_id", None)

        detail["balances"] = balances

        total_on_hand = sum(b["quantity"] for b in balances)
        detail["total_on_hand"] = total_on_hand

        cost_row = self.db.execute("""
            SELECT
                (SELECT ph.unit_price
                 FROM price_history ph
                 JOIN supplier_products sp ON sp.id = ph.supplier_product_id
                 WHERE sp.product_id = %s
                 ORDER BY ph.effective_from DESC, ph.id DESC LIMIT 1
                ) AS last_purchase_cost,
                (SELECT ph.effective_from
                 FROM price_history ph
                 JOIN supplier_products sp ON sp.id = ph.supplier_product_id
                 WHERE sp.product_id = %s
                 ORDER BY ph.effective_from DESC, ph.id DESC LIMIT 1
                ) AS last_purchase_date,
                (SELECT ROUND(
                    (SUM(il.quantity * il.unit_price) / NULLIF(SUM(il.quantity), 0))
                ::numeric, 4)
                 FROM invoice_lines il
                 JOIN supplier_products sp ON sp.id = il.supplier_product_id
                 WHERE sp.product_id = %s AND il.quantity > 0
                ) AS average_cost,
                (SELECT MIN(ph.unit_price)
                 FROM price_history ph
                 JOIN supplier_products sp ON sp.id = ph.supplier_product_id
                 WHERE sp.product_id = %s
                   AND ph.effective_from >= (NOW() - INTERVAL '90 days')::date
                ) AS min_cost_90d,
                (SELECT MAX(ph.unit_price)
                 FROM price_history ph
                 JOIN supplier_products sp ON sp.id = ph.supplier_product_id
                 WHERE sp.product_id = %s
                   AND ph.effective_from >= (NOW() - INTERVAL '90 days')::date
                ) AS max_cost_90d,
                (SELECT COALESCE(SUM(
                    CASE WHEN i.invoice_type = 'credit_note' THEN -il.quantity ELSE il.quantity END
                 ), 0)
                 FROM invoice_lines il
                 JOIN invoices i ON i.id = il.invoice_id
                 JOIN supplier_products sp ON sp.id = il.supplier_product_id
                 WHERE sp.product_id = %s
                ) AS total_purchased,
                (SELECT sp_price.current_price
                 FROM supplier_products sp_price
                 WHERE sp_price.product_id = %s
                 ORDER BY sp_price.is_preferred_supplier DESC, sp_price.current_price ASC
                 LIMIT 1
                ) AS supplier_price
        """, (product_id,) * 7).fetchone()
        detail["cost"] = dict(cost_row)

        wac = detail["cost"]["average_cost"]
        lc  = detail["cost"]["last_purchase_cost"]
        sp  = detail["cost"].get("supplier_price")
        cost_for_value = wac if wac is not None else (lc if lc is not None else (sp if sp is not None else 0.0))

        # Use supplier_price as fallback for display when no invoice cost exists
        if lc is None and sp is not None:
            detail["cost"]["last_purchase_cost"] = sp
        if wac is None and sp is not None:
            detail["cost"]["average_cost"] = sp

        detail["missing_cost"] = detail["cost"]["last_purchase_cost"] is None and detail["cost"]["average_cost"] is None
        # cost_for_value is per wholesale unit — convert total_on_hand to wholesale
        pack_qty = total_on_hand / units_per_pack if units_per_pack else total_on_hand
        detail["stock_value"]  = round(pack_qty * cost_for_value, 4) if cost_for_value else 0.0
        detail["stock_status"] = self._stock_status(total_on_hand, detail.get("min_stock_level"))

        detail["suppliers"] = [dict(r) for r in self.db.execute("""
            SELECT sp.id AS supplier_product_id,
                   sp.supplier_id, s.name AS supplier_name,
                   sp.supplier_sku, sp.current_price,
                   sp.is_preferred_supplier AS is_preferred,
                   COALESCE(sp.total_quantity_ordered, 0) AS total_ordered,
                   (SELECT MAX(i.invoice_date)
                    FROM invoices i JOIN invoice_lines il ON il.invoice_id = i.id
                    WHERE il.supplier_product_id = sp.id
                   ) AS last_invoice_date
            FROM supplier_products sp
            JOIN suppliers s ON s.id = sp.supplier_id
            WHERE sp.product_id = %s
            ORDER BY sp.is_preferred_supplier DESC, s.name
        """, (product_id,)).fetchall()]

        recipe_rows = [dict(r) for r in self.db.execute("""
            SELECT cp.id AS recipe_id, cp.name AS recipe_name,
                   cp.selling_price, cpc.quantity AS quantity_needed, cpc.unit
            FROM composite_product_components cpc
            JOIN composite_products cp ON cp.id = cpc.composite_product_id
            WHERE cpc.component_product_id = %s
            ORDER BY cp.name
        """, (product_id,)).fetchall()]
        for r in recipe_rows:
            needed = r["quantity_needed"] or 0
            r["can_produce"] = int(total_on_hand / needed) if needed > 0 else 0
        detail["recipes"] = recipe_rows

        return detail

    def get_product_movements(
        self,
        product_id: int,
        location_id: int | None = None,
        movement_type: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        where = ["sm.product_id = %s"]
        params: list = [product_id]
        if location_id:
            where.append("sm.location_id = %s")
            params.append(location_id)
        if movement_type:
            where.append("sm.movement_type = %s")
            params.append(movement_type)

        total = self.db.execute(
            f"SELECT COUNT(*) FROM stock_movements sm WHERE {' AND '.join(where)}",
            params,
        ).fetchone()[0]

        rows = self.db.execute(f"""
            SELECT sm.id, sm.movement_type, sm.quantity,
                   CASE WHEN p.pack_unit_id IS NOT NULL AND sm.unit_id = p.pack_unit_id
                        THEN pack_uom.abbreviation
                        ELSE prod_uom.abbreviation
                   END AS unit,
                   sm.location_id,
                   sl.name AS location_name,
                   sm.reason, sm.reference_id, sm.reference_type,
                   sm.notes, sm.moved_at,
                   CASE WHEN sm.reference_type = 'invoice_line' THEN (
                       SELECT i.invoice_number
                       FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id
                       WHERE il.id = sm.reference_id
                   ) ELSE NULL END AS invoice_number,
                   CASE WHEN sm.reference_type = 'invoice_line' THEN (
                       SELECT i.id
                       FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id
                       WHERE il.id = sm.reference_id
                   ) ELSE NULL END AS invoice_id
            FROM stock_movements sm
            JOIN products p ON p.id = sm.product_id
            LEFT JOIN units_of_measure prod_uom ON prod_uom.id = p.unit_id
            LEFT JOIN units_of_measure pack_uom ON pack_uom.id = p.pack_unit_id
            LEFT JOIN stock_locations sl ON sl.id = sm.location_id
            WHERE {' AND '.join(where)}
            ORDER BY sm.moved_at DESC, sm.id DESC
            LIMIT %s OFFSET %s
        """, params + [limit, offset]).fetchall()

        return {
            "movements": [dict(r) for r in rows],
            "total":  total,
            "limit":  limit,
            "offset": offset,
        }

    def _to_balance_units(self, product_id: int, location_id: int, quantity: float) -> tuple[float, int | None]:
        """Convert a retail-unit quantity to the unit stored in the balance for this location."""
        row = self.db.execute("""
            SELECT p.unit_id        AS retail_unit_id,
                   p.pack_unit_id,
                   p.units_per_pack,
                   ib.unit_id       AS balance_unit_id
            FROM products p
            LEFT JOIN inventory_balances ib ON ib.product_id = p.id AND ib.location_id = %s
            WHERE p.id = %s
        """, (location_id, product_id)).fetchone()
        if not row:
            return quantity, None
        if (row["units_per_pack"] and row["pack_unit_id"] is not None
                and row["balance_unit_id"] == row["pack_unit_id"]):
            return quantity / row["units_per_pack"], row["pack_unit_id"]
        # Default: if no balance and product has a pack unit, use it
        if row["units_per_pack"] and row["pack_unit_id"] is not None and row["balance_unit_id"] is None:
            return quantity / row["units_per_pack"], row["pack_unit_id"]
        return quantity, row["balance_unit_id"] or row["retail_unit_id"]

    def adjust_stock(
        self,
        product_id: int,
        location_id: int,
        direction: str,
        quantity: float,
        reason: str | None,
        notes: str | None,
    ) -> None:
        qty, unit_id = self._to_balance_units(product_id, location_id, quantity)
        movement_type = "adjustment_up" if direction == "up" else "adjustment_down"
        signed_qty = qty if direction == "up" else -qty
        result = post_movements(self.db, [{
            "product_id": product_id,
            "location_id": location_id,
            "unit_id": unit_id,
            "movement_type": movement_type,
            "quantity": signed_qty,
            "reason": reason,
            "notes": notes,
        }])
        if not result["success"]:
            raise ValueError("Adjustment would result in negative stock")

    def record_waste(
        self,
        product_id: int,
        location_id: int,
        quantity: float,
        reason: str | None,
        notes: str | None,
    ) -> None:
        qty, unit_id = self._to_balance_units(product_id, location_id, quantity)
        result = post_movements(self.db, [{
            "product_id": product_id,
            "location_id": location_id,
            "unit_id": unit_id,
            "movement_type": "waste",
            "quantity": -qty,
            "reason": reason,
            "notes": notes,
        }])
        if not result["success"]:
            raise ValueError("Waste would result in negative stock")

    def transfer_stock(
        self,
        product_id: int,
        from_location_id: int,
        to_location_id: int,
        quantity: float,
        notes: str | None,
    ) -> None:
        qty, from_unit = self._to_balance_units(product_id, from_location_id, quantity)
        _,    to_unit   = self._to_balance_units(product_id, to_location_id, quantity)
        # If destination has no balance yet, mirror source unit for consistency
        if to_unit != from_unit:
            dest = self.db.execute(
                "SELECT COALESCE(quantity, 0) AS qty FROM inventory_balances WHERE product_id = %s AND location_id = %s",
                (product_id, to_location_id),
            ).fetchone()
            if not dest or dest["qty"] == 0:
                to_unit = from_unit
        result = post_movements(self.db, [
            {
                "product_id": product_id,
                "location_id": from_location_id,
                "unit_id": from_unit,
                "movement_type": "transfer_out",
                "quantity": -qty,
                "notes": notes,
            },
            {
                "product_id": product_id,
                "location_id": to_location_id,
                "unit_id": to_unit,
                "movement_type": "transfer_in",
                "quantity": qty,
                "notes": notes,
            },
        ])
        if not result["success"]:
            raise ValueError("Transfer would result in negative stock")

    def set_threshold(self, product_id: int, min_stock_level: float | None) -> None:
        self.db.execute(
            "UPDATE products SET min_stock_level = %s WHERE id = %s",
            (min_stock_level, product_id),
        )
        self.db.commit()

    @staticmethod
    def overview_to_csv(rows: list[dict]) -> str:
        if not rows:
            return "product_id,product_name,category,on_hand_qty,unit,latest_cost,weighted_avg_cost,stock_value,preferred_supplier,stock_status\n"
        buf = io.StringIO()
        fieldnames = [
            "product_id", "product_name", "category", "on_hand_qty", "unit",
            "latest_cost", "weighted_avg_cost", "stock_value",
            "preferred_supplier", "stock_status",
        ]
        writer = csv.DictWriter(buf, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
        return buf.getvalue()

    @staticmethod
    def _stock_status(qty: float, min_l: float | None) -> str:
        if qty < 0:   return "negative"
        if qty == 0:  return "out_of_stock"
        if min_l is not None and qty <= min_l: return "low_stock"
        return "ok"


def get_inventory_repo(db: DBConnection = Depends(get_db)) -> InventoryRepository:
    return InventoryRepository(db)
