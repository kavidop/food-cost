import math

from fastapi import Depends

from ..database import get_db
from ..protocols import DBConnection
from ..services.inventory_posting_service import post_movements


class RecipeRepository:
    def __init__(self, db: DBConnection) -> None:
        self.db = db

    def list_recipes(
        self,
        include_archived: bool = False,
        product_type: str | None = None,
    ) -> list[dict]:
        conditions: list[str] = []
        params: list = []

        if not include_archived:
            conditions.append("cp.is_archived = 0")
        if product_type is not None:
            conditions.append("cp.product_type = %s")
            params.append(product_type)

        where = " WHERE " + " AND ".join(conditions) if conditions else ""

        cps = [dict(r) for r in self.db.execute(
            f"""
            SELECT cp.*,
                COALESCE((
                    SELECT SUM(ib.quantity)
                    FROM recipe_yields ry
                    JOIN inventory_balances ib ON ib.product_id = ry.yield_product_id
                    WHERE ry.composite_product_id = cp.id
                ), 0) AS current_stock,
                (
                    SELECT ry.yield_product_id
                    FROM recipe_yields ry
                    WHERE ry.composite_product_id = cp.id
                    LIMIT 1
                ) AS linked_product_id
            FROM composite_products cp{where}
            ORDER BY cp.name
            """,
            params if params else None,
        ).fetchall()]

        result = []
        for cp in cps:
            calc = self._calc_composite(self.db.cursor(), cp["id"])
            sp   = cp.get("selling_price") or 0
            fc   = calc["total_food_cost"]
            result.append({
                **cp,
                "total_food_cost": fc,
                "component_count": len(calc["components"]),
                "max_producible":  calc["max_producible"],
                "margin_pct":      round((sp - fc) / sp * 100, 1) if sp > 0 else None,
            })
        return result

    def get_recipe(self, cp_id: int) -> dict | None:
        row = self.db.execute("""
            SELECT cp.*,
                COALESCE((
                    SELECT SUM(ib.quantity)
                    FROM recipe_yields ry
                    JOIN inventory_balances ib ON ib.product_id = ry.yield_product_id
                    WHERE ry.composite_product_id = cp.id
                ), 0) AS current_stock,
                (
                    SELECT ry.yield_product_id
                    FROM recipe_yields ry
                    WHERE ry.composite_product_id = cp.id
                    LIMIT 1
                ) AS linked_product_id
            FROM composite_products cp
            WHERE cp.id = %s
        """, (cp_id,)).fetchone()
        if not row:
            return None
        cp   = dict(row)
        calc = self._calc_composite(self.db.cursor(), cp_id)
        sp   = cp.get("selling_price") or 0
        fc   = calc["total_food_cost"]

        linked_in = [dict(r) for r in self.db.execute("""
            SELECT cp2.id, cp2.name, cp2.selling_price, cpc.quantity, cpc.unit
            FROM composite_product_components cpc
            JOIN composite_products cp2 ON cp2.id = cpc.composite_product_id
            WHERE cpc.component_composite_id = %s
              AND cp2.is_archived = 0
            ORDER BY cp2.name
        """, (cp_id,)).fetchall()]

        return {
            **cp,
            "total_food_cost": fc,
            "component_count": len(calc["components"]),
            "max_producible":  calc["max_producible"],
            "bottleneck":      calc["bottleneck"],
            "margin_pct":      round((sp - fc) / sp * 100, 1) if sp > 0 else None,
            "components":      calc["components"],
            "linked_in_recipes": linked_in,
        }

    def create_recipe(self, data) -> int:
        cur = self.db.cursor()
        product_type = getattr(data, "product_type", "composite") or "composite"
        cur.execute("""
            INSERT INTO composite_products
                (name, category, selling_price, selling_price_takeaway, selling_price_delivery,
                 servings, yield_quantity, yield_unit, prep_time_minutes, notes, product_type)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (data.name, data.category, data.selling_price,
              data.selling_price_takeaway, data.selling_price_delivery,
              data.servings, data.yield_quantity, data.yield_unit,
              data.prep_time_minutes, data.notes, product_type))
        cp_id = cur.lastrowid

        if product_type == "intermediate":
            self._ensure_linked_product(cur, cp_id, data.name, data.yield_quantity, data.yield_unit)

        self._insert_components(cur, cp_id, data.components)
        self.db.commit()
        return cp_id

    def update_recipe(self, cp_id: int, data) -> None:
        product_type = getattr(data, "product_type", "composite") or "composite"
        cur = self.db.cursor()
        cur.execute("""
            UPDATE composite_products
            SET name=%s, category=%s, selling_price=%s,
                selling_price_takeaway=%s, selling_price_delivery=%s,
                servings=%s, yield_quantity=%s, yield_unit=%s,
                prep_time_minutes=%s, notes=%s, product_type=%s
            WHERE id=%s
        """, (data.name, data.category, data.selling_price,
              data.selling_price_takeaway, data.selling_price_delivery,
              data.servings, data.yield_quantity, data.yield_unit,
              data.prep_time_minutes, data.notes, product_type, cp_id))

        yield_row = self.db.execute(
            "SELECT yield_product_id FROM recipe_yields WHERE composite_product_id=%s LIMIT 1",
            (cp_id,),
        ).fetchone()

        if yield_row and yield_row["yield_product_id"]:
            unit_id = self._resolve_unit_id(data.yield_unit)
            self.db.execute(
                "UPDATE products SET name=%s WHERE id=%s",
                (data.name, yield_row["yield_product_id"]),
            )
            self.db.execute(
                "UPDATE recipe_yields SET yield_quantity=%s, unit_id=%s WHERE composite_product_id=%s",
                (data.yield_quantity or 1.0, unit_id, cp_id),
            )
        elif product_type == "intermediate":
            self._ensure_linked_product(cur, cp_id, data.name, data.yield_quantity, data.yield_unit)

        cur.execute(
            "DELETE FROM composite_product_components WHERE composite_product_id=%s", (cp_id,)
        )
        self._insert_components(cur, cp_id, data.components)
        self.db.commit()

    def duplicate_recipe(self, cp_id: int) -> int | None:
        row = self.db.execute("SELECT * FROM composite_products WHERE id=%s", (cp_id,)).fetchone()
        if not row:
            return None
        cp  = dict(row)
        cur = self.db.cursor()
        cur.execute("""
            INSERT INTO composite_products
                (name, category, selling_price, selling_price_takeaway, selling_price_delivery,
                 servings, yield_quantity, yield_unit, prep_time_minutes, notes, product_type)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            f"Copy of {cp['name']}", cp.get("category"),
            cp.get("selling_price"), cp.get("selling_price_takeaway"), cp.get("selling_price_delivery"),
            cp.get("servings", 1), cp.get("yield_quantity"), cp.get("yield_unit"),
            cp.get("prep_time_minutes"), cp.get("notes"), cp.get("product_type", "composite"),
        ))
        new_id = cur.lastrowid

        if cp.get("product_type") == "intermediate":
            self._ensure_linked_product(
                cur, new_id, f"Copy of {cp['name']}",
                cp.get("yield_quantity"), cp.get("yield_unit"),
            )

        for c in self.db.execute(
            "SELECT * FROM composite_product_components WHERE composite_product_id=%s", (cp_id,)
        ).fetchall():
            cur.execute("""
                INSERT INTO composite_product_components
                    (composite_product_id, component_product_id, component_composite_id, quantity, unit)
                VALUES (%s, %s, %s, %s, %s)
            """, (new_id, c["component_product_id"], c["component_composite_id"], c["quantity"], c["unit"]))
        self.db.commit()
        return new_id

    def set_archived(self, cp_id: int, is_archived: bool) -> bool:
        cur = self.db.execute(
            "UPDATE composite_products SET is_archived=%s WHERE id=%s", (int(is_archived), cp_id)
        )
        self.db.commit()
        return cur.rowcount > 0

    def delete_recipe(self, cp_id: int) -> None:
        # Delete the auto-created linked product if it has no stock
        yield_row = self.db.execute(
            "SELECT yield_product_id FROM recipe_yields WHERE composite_product_id=%s LIMIT 1",
            (cp_id,),
        ).fetchone()
        if yield_row and yield_row["yield_product_id"]:
            linked_id = yield_row["yield_product_id"]
            balance = self.db.execute(
                "SELECT COALESCE(SUM(quantity), 0) AS qty FROM inventory_balances WHERE product_id=%s",
                (linked_id,),
            ).fetchone()
            if balance and float(balance["qty"]) == 0:
                self.db.execute("DELETE FROM products WHERE id=%s", (linked_id,))

        self.db.execute(
            "DELETE FROM composite_product_components WHERE composite_product_id=%s", (cp_id,)
        )
        self.db.execute("DELETE FROM composite_products WHERE id=%s", (cp_id,))
        self.db.commit()

    def create_production_batch(self, cp_id: int, data) -> dict:
        cp = self.db.execute(
            "SELECT * FROM composite_products WHERE id=%s AND product_type='intermediate'", (cp_id,)
        ).fetchone()
        if not cp:
            raise ValueError("Intermediate product not found")

        yield_row = self.db.execute(
            "SELECT yield_product_id, yield_quantity FROM recipe_yields WHERE composite_product_id=%s LIMIT 1",
            (cp_id,),
        ).fetchone()

        calc      = self._calc_composite(self.db.cursor(), cp_id)
        batch_size = float(data.batch_size)
        entries: list[dict] = []

        for comp in calc["components"]:
            product_id = comp.get("product_id")
            if product_id:
                entries.append({
                    "product_id": product_id,
                    "location_id": data.location_id,
                    "movement_type": "production_consumption",
                    "quantity": -(comp["eff_qty"] * batch_size),
                })

        expected_yield: float | None = None
        actual_yield:   float | None = None
        if yield_row and yield_row["yield_product_id"]:
            expected_yield = float(yield_row["yield_quantity"]) * batch_size
            actual_yield   = data.actual_yield if data.actual_yield is not None else expected_yield
            entries.append({
                "product_id": yield_row["yield_product_id"],
                "location_id": data.location_id,
                "movement_type": "production_output",
                "quantity": actual_yield,
            })

        cur = self.db.cursor()
        cur.execute("""
            INSERT INTO production_batches
                (composite_product_id, location_id, batch_size, notes, status)
            VALUES (%s, %s, %s, %s, 'committed')
        """, (cp_id, data.location_id, batch_size, data.notes))
        batch_id = cur.lastrowid

        for e in entries:
            e["reference_id"]   = batch_id
            e["reference_type"] = "production_batch"

        result = post_movements(self.db, entries, allow_negative=True, commit=False)
        if not result["success"]:
            raise ValueError(f"Failed to post movements: {result.get('warning')}")

        total_cost      = round(calc["total_food_cost"] * batch_size, 4)
        cost_per_serving = round(calc["total_food_cost"], 4)
        cur.execute("""
            INSERT INTO recipe_cost_snapshots
                (production_batch_id, composite_product_id, total_food_cost, cost_per_serving)
            VALUES (%s, %s, %s, %s)
        """, (batch_id, cp_id, total_cost, cost_per_serving))

        self.db.commit()
        return {
            "batch_id":         batch_id,
            "total_cost":       total_cost,
            "movements_created": len(result["movement_ids"]),
            "expected_yield":   expected_yield,
            "actual_yield":     actual_yield,
        }

    def list_production_batches(self, cp_id: int) -> list[dict]:
        return [dict(r) for r in self.db.execute("""
            SELECT pb.id, pb.composite_product_id, pb.location_id, pb.batch_size,
                   pb.produced_at, pb.notes, pb.status,
                   sl.name AS location_name,
                   COALESCE(rcs.total_food_cost, 0)  AS total_food_cost,
                   COALESCE(rcs.cost_per_serving, 0) AS cost_per_serving
            FROM production_batches pb
            JOIN stock_locations sl ON sl.id = pb.location_id
            LEFT JOIN recipe_cost_snapshots rcs ON rcs.production_batch_id = pb.id
            WHERE pb.composite_product_id = %s
            ORDER BY pb.produced_at DESC
            LIMIT 20
        """, (cp_id,)).fetchall()]

    # ── Helpers ────────────────────────────────────────────────────────────────

    def _ensure_linked_product(self, cur, cp_id: int, name: str, yield_qty, yield_unit) -> None:
        """Create a shadow products row and link it via recipe_yields."""
        cur.execute(
            "INSERT INTO products (name, is_active) VALUES (%s, 1)",
            (name,),
        )
        linked_product_id = cur.lastrowid
        unit_id = self._resolve_unit_id(yield_unit)
        cur.execute("""
            INSERT INTO recipe_yields (composite_product_id, yield_product_id, yield_quantity, unit_id)
            VALUES (%s, %s, %s, %s)
        """, (cp_id, linked_product_id, yield_qty or 1.0, unit_id))

    def _resolve_unit_id(self, yield_unit: str | None) -> int | None:
        if not yield_unit:
            return None
        row = self.db.execute(
            "SELECT id FROM units_of_measure WHERE abbreviation=%s OR name=%s LIMIT 1",
            (yield_unit, yield_unit),
        ).fetchone()
        return row["id"] if row else None

    def _insert_components(self, cur, cp_id: int, components: list) -> None:
        for comp in components:
            cur.execute("""
                INSERT INTO composite_product_components
                    (composite_product_id, component_product_id, component_composite_id, quantity, unit)
                VALUES (%s, %s, %s, %s, %s)
            """, (cp_id, comp.product_id, comp.composite_id, comp.quantity, comp.unit))

    def _calc_composite(self, cur, cp_id: int) -> dict:
        prod_rows = cur.execute("""
            SELECT cpc.id, cpc.quantity, cpc.unit,
                   p.id   AS product_id,
                   p.name AS product_name,
                   COALESCE(p.units_per_pack, 1) AS units_per_pack,
                   prod_uom.abbreviation      AS product_unit,
                   prod_uom.id                AS prod_unit_id,
                   prod_uom.base_unit_id      AS prod_base_id,
                   prod_uom.conversion_factor AS prod_conv,
                   comp_uom.id                AS comp_unit_id,
                   comp_uom.base_unit_id      AS comp_base_id,
                   comp_uom.conversion_factor AS comp_conv,
                   COALESCE(
                       (SELECT MIN(sp.current_price)
                        FROM supplier_products sp
                        WHERE sp.product_id = p.id AND sp.current_price IS NOT NULL), 0
                   ) AS unit_price_wholesale,
                   COALESCE(
                       (SELECT SUM(ib.quantity)
                        FROM inventory_balances ib WHERE ib.product_id = p.id), 0
                   ) AS stock_wholesale
            FROM composite_product_components cpc
            JOIN products p ON p.id = cpc.component_product_id
            LEFT JOIN units_of_measure prod_uom ON prod_uom.id = p.unit_id
            LEFT JOIN units_of_measure comp_uom ON comp_uom.abbreviation = cpc.unit
            WHERE cpc.composite_product_id = %s
              AND cpc.component_product_id IS NOT NULL
        """, (cp_id,)).fetchall()

        comp_rows = cur.execute("""
            SELECT cpc.id, cpc.quantity, cpc.unit,
                   cp.id       AS composite_id,
                   cp.name     AS product_name,
                   cp.servings AS servings
            FROM composite_product_components cpc
            JOIN composite_products cp ON cp.id = cpc.component_composite_id
            WHERE cpc.composite_product_id = %s
              AND cpc.component_composite_id IS NOT NULL
        """, (cp_id,)).fetchall()

        components  = []
        total_cost  = 0.0
        min_produce = float("inf")
        bottleneck  = None

        for r in [dict(r) for r in prod_rows]:
            upp     = r["units_per_pack"] or 1
            conv    = self._unit_factor(
                r["comp_unit_id"], r["comp_base_id"], r["comp_conv"],
                r["prod_unit_id"], r["prod_base_id"], r["prod_conv"],
            )
            eff_qty     = r["quantity"] * conv
            unit_cost   = r["unit_price_wholesale"] / upp
            comp_cost   = eff_qty * unit_cost
            stock_ret   = r["stock_wholesale"] * upp
            can_produce = math.floor(round(stock_ret / eff_qty, 9)) if eff_qty > 0 else 0

            r["eff_qty"]        = round(eff_qty, 6)
            r["unit_cost"]      = round(unit_cost, 4)
            r["component_cost"] = round(comp_cost, 4)
            r["stock_retail"]   = round(stock_ret, 2)
            r["can_produce"]    = can_produce
            r["is_composite"]   = False
            r["composite_id"]   = None
            components.append(r)
            total_cost += comp_cost

            if can_produce < min_produce:
                min_produce = can_produce
                bottleneck  = r["product_name"]

        for r in [dict(r) for r in comp_rows]:
            sub            = self._calc_composite(cur, r["composite_id"])
            servings       = r["servings"] or 1
            unit_cost      = sub["total_food_cost"] / servings
            comp_cost      = r["quantity"] * unit_cost
            avail_servings = sub["max_producible"] * servings
            can_produce    = math.floor(round(avail_servings / r["quantity"], 9)) if r["quantity"] > 0 else 0

            r["product_id"]     = None
            r["product_unit"]   = None
            r["eff_qty"]        = float(r["quantity"])
            r["unit_cost"]      = round(unit_cost, 4)
            r["component_cost"] = round(comp_cost, 4)
            r["stock_retail"]   = float(avail_servings)
            r["can_produce"]    = can_produce
            r["is_composite"]   = True
            components.append(r)
            total_cost += comp_cost

            if can_produce < min_produce:
                min_produce = can_produce
                bottleneck  = r["product_name"]

        return {
            "components":      components,
            "total_food_cost": round(total_cost, 4),
            "max_producible":  int(min_produce) if min_produce != float("inf") else 0,
            "bottleneck":      bottleneck,
        }

    @staticmethod
    def _unit_factor(comp_unit_id, comp_base_id, comp_conv,
                     prod_unit_id, prod_base_id, prod_conv) -> float:
        if None in (comp_unit_id, prod_unit_id) or comp_unit_id == prod_unit_id:
            return 1.0
        if comp_base_id == prod_unit_id and comp_conv:
            return float(comp_conv)
        if prod_base_id == comp_unit_id and prod_conv:
            return 1.0 / float(prod_conv)
        if comp_base_id is not None and comp_base_id == prod_base_id:
            return float(comp_conv or 1) / float(prod_conv or 1)
        return 1.0


def get_recipe_repo(db: DBConnection = Depends(get_db)) -> RecipeRepository:
    return RecipeRepository(db)
