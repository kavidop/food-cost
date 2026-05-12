from fastapi import Depends

from ..database import get_db
from ..protocols import DBConnection
from .recipe import RecipeRepository


class DashboardRepository:
    def __init__(self, db: DBConnection) -> None:
        self.db = db

    def get_dashboard_data(self) -> dict:
        inventory_rows = self._inventory_overview_rows()
        recipes = RecipeRepository(self.db).list_recipes()

        low_stock_items    = [r for r in inventory_rows if r["stock_status"] in ("low_stock", "out_of_stock", "negative")]
        missing_cost_items = [r for r in inventory_rows if r["missing_cost"]]
        total_stock_value  = round(sum(r["stock_value"] for r in inventory_rows), 2)
        stock_value_non_fb = round(sum(r["stock_value"] for r in inventory_rows if r.get("category_id") == 40), 2)

        recipe_margins  = [r["margin_pct"] for r in recipes if r["margin_pct"] is not None]
        avg_margin_pct  = round(sum(recipe_margins) / len(recipe_margins), 1) if recipe_margins else None
        blocked_recipes = [r for r in recipes if r["max_producible"] == 0]
        low_margin_recipes = [r for r in recipes if r["margin_pct"] is not None and r["margin_pct"] < 60]

        waste_30d = self.db.execute("""
            SELECT
                COUNT(*) AS total_events,
                ROUND(COALESCE(SUM(ABS(sm.quantity) * COALESCE((
                    SELECT SUM(il.line_net_amount) / NULLIF(SUM(il.quantity), 0)
                    FROM invoice_lines il
                    JOIN supplier_products sp ON sp.id = il.supplier_product_id
                    WHERE sp.product_id = sm.product_id
                ), 0)), 0)::numeric, 2) AS total_value
            FROM stock_movements sm
            WHERE sm.movement_type = 'waste'
              AND sm.moved_at::date >= (NOW() - INTERVAL '30 days')::date
              AND NOT EXISTS (
                  SELECT 1 FROM stock_movements sv WHERE sv.reference_type='void' AND sv.reference_id=sm.id
              )
        """).fetchone()

        transfer_summary = self.db.execute("""
            SELECT
                COUNT(*) AS total_transfers,
                COUNT(CASE WHEN status = 'draft' THEN 1 END) AS draft_transfers,
                COUNT(CASE WHEN status = 'confirmed' THEN 1 END) AS confirmed_transfers
            FROM stock_transfers
        """).fetchone()

        stats = {
            "products":    self.db.execute("SELECT COUNT(*) FROM products").fetchone()[0],
            "suppliers":   self.db.execute("SELECT COUNT(*) FROM suppliers").fetchone()[0],
            "invoices":    self.db.execute("SELECT COUNT(*) FROM invoices").fetchone()[0],
            "total_spend": round(
                self.db.execute("""
                    SELECT COALESCE(SUM(
                        CASE WHEN i.invoice_type = 'invoice' THEN il.line_gross_amount
                             ELSE -il.line_gross_amount END
                    ), 0)
                    FROM invoice_lines il
                    JOIN invoices i ON i.id = il.invoice_id
                """).fetchone()[0], 2
            ),
            "total_spend_non_fb": round(
                self.db.execute("""
                    SELECT COALESCE(SUM(il.line_gross_amount), 0)
                    FROM invoice_lines il
                    JOIN supplier_products sp ON sp.id = il.supplier_product_id
                    JOIN products p ON p.id = sp.product_id
                    WHERE p.category_id = 40
                """).fetchone()[0], 2
            ),
            "recipes": len(recipes),
            "stock_value": total_stock_value,
            "stock_value_non_fb": stock_value_non_fb,
            "low_stock_products":      len([r for r in inventory_rows if r["stock_status"] == "low_stock"]),
            "out_of_stock_products":   len([r for r in inventory_rows if r["stock_status"] == "out_of_stock"]),
            "negative_stock_products": len([r for r in inventory_rows if r["stock_status"] == "negative"]),
            "missing_cost_products":   len(missing_cost_items),
            "waste_events_30d": waste_30d["total_events"] or 0,
            "waste_value_30d":  waste_30d["total_value"] or 0.0,
            "draft_transfers":  transfer_summary["draft_transfers"] or 0,
            "avg_recipe_margin_pct": avg_margin_pct,
            "blocked_recipes": len(blocked_recipes),
        }

        recent_invoices = [dict(r) for r in self.db.execute("""
            SELECT i.id, i.invoice_number, i.invoice_date, i.gross_amount,
                   COALESCE(NULLIF(s.trade_name,''), s.name) AS supplier_name
            FROM invoices i JOIN suppliers s ON s.id = i.supplier_id
            ORDER BY i.invoice_date DESC LIMIT 6
        """).fetchall()]

        by_category = [dict(r) for r in self.db.execute("""
            SELECT name, SUM(cnt) AS cnt
            FROM (
                SELECT pc.name, COUNT(p.id) AS cnt
                FROM products p JOIN product_categories pc ON pc.id = p.category_id
                GROUP BY pc.id, pc.name
            ) sub
            GROUP BY name ORDER BY cnt DESC LIMIT 12
        """).fetchall()]

        by_supplier = [dict(r) for r in self.db.execute("""
            SELECT COALESCE(NULLIF(s.trade_name,''), s.name) AS name,
                   COUNT(i.id) AS invoices,
                   COALESCE(SUM(i.gross_amount), 0) AS total
            FROM suppliers s LEFT JOIN invoices i ON i.supplier_id = s.id
            GROUP BY s.id, s.name, s.trade_name ORDER BY total DESC
        """).fetchall()]

        inventory_alerts = [
            {
                "product_id":     r["product_id"],
                "product_name":   r["product_name"],
                "unit":           r["unit"],
                "on_hand_qty":    r["on_hand_qty"],
                "min_stock_level": r["min_stock_level"],
                "stock_status":   r["stock_status"],
            }
            for r in sorted(
                low_stock_items,
                key=lambda row: (
                    0 if row["stock_status"] == "negative" else 1 if row["stock_status"] == "out_of_stock" else 2,
                    row["product_name"],
                ),
            )[:8]
        ]

        waste_hotspots = [dict(r) for r in self.db.execute("""
            SELECT
                sm.product_id,
                p.name AS product_name,
                pc.name AS category,
                ROUND(SUM(ABS(sm.quantity))::numeric, 4) AS total_quantity,
                uom.abbreviation AS unit,
                ROUND(COALESCE(SUM(ABS(sm.quantity) * COALESCE((
                    SELECT SUM(il.line_net_amount) / NULLIF(SUM(il.quantity), 0)
                    FROM invoice_lines il
                    JOIN supplier_products sp ON sp.id = il.supplier_product_id
                    WHERE sp.product_id = sm.product_id
                ), 0)), 0)::numeric, 2) AS total_value
            FROM stock_movements sm
            JOIN products p ON p.id = sm.product_id
            LEFT JOIN product_categories pc ON pc.id = p.category_id
            LEFT JOIN units_of_measure uom ON uom.id = sm.unit_id
            WHERE sm.movement_type = 'waste'
              AND sm.moved_at::date >= (NOW() - INTERVAL '30 days')::date
              AND NOT EXISTS (
                  SELECT 1 FROM stock_movements sv WHERE sv.reference_type='void' AND sv.reference_id=sm.id
              )
            GROUP BY sm.product_id, p.name, pc.name, uom.abbreviation
            ORDER BY total_value DESC, total_quantity DESC
            LIMIT 6
        """).fetchall()]

        recipe_watchlist = [
            {
                "id":             r["id"],
                "name":           r["name"],
                "total_food_cost": r["total_food_cost"],
                "selling_price":  r["selling_price"],
                "margin_pct":     r["margin_pct"],
                "max_producible": r["max_producible"],
                "status": "blocked" if r["max_producible"] == 0 else "low_margin",
            }
            for r in sorted(
                blocked_recipes + low_margin_recipes,
                key=lambda row: (row["max_producible"] > 0, row["margin_pct"] if row["margin_pct"] is not None else 999),
            )[:8]
        ]

        purchasing_snapshot = [dict(r) for r in self.db.execute("""
            SELECT COALESCE(NULLIF(s.trade_name,''), s.name) AS name,
                   COUNT(i.id) AS invoices,
                   ROUND(COALESCE(SUM(i.gross_amount), 0)::numeric, 2) AS total,
                   MAX(i.invoice_date) AS last_invoice_date
            FROM suppliers s
            LEFT JOIN invoices i ON i.supplier_id = s.id
            GROUP BY s.id, s.name, s.trade_name
            ORDER BY total DESC, invoices DESC
            LIMIT 6
        """).fetchall()]

        return {
            "stats":             stats,
            "recent_invoices":   recent_invoices,
            "by_category":       by_category,
            "by_supplier":       by_supplier,
            "inventory_alerts":  inventory_alerts,
            "waste_hotspots":    waste_hotspots,
            "recipe_watchlist":  recipe_watchlist,
            "purchasing_snapshot": purchasing_snapshot,
            "by_main_category":  self._get_main_category_breakdown(inventory_rows),
        }

    def _get_main_category_breakdown(self, inventory_rows: list[dict]) -> list[dict]:
        # Build category → root mapping via recursive CTE
        cat_rows = self.db.execute("""
            WITH RECURSIVE cat_root AS (
                SELECT id, name AS root_name, id AS root_id
                FROM product_categories WHERE parent_id IS NULL
                UNION ALL
                SELECT c.id, cr.root_name, cr.root_id
                FROM product_categories c
                JOIN cat_root cr ON cr.id = c.parent_id
            )
            SELECT id, root_id, root_name FROM cat_root
        """).fetchall()
        cat_to_root = {r["id"]: (r["root_id"], r["root_name"]) for r in cat_rows}

        # Net spend per root category (invoices minus credit notes)
        spend_rows = self.db.execute("""
            WITH RECURSIVE cat_root AS (
                SELECT id, id AS root_id FROM product_categories WHERE parent_id IS NULL
                UNION ALL
                SELECT c.id, cr.root_id FROM product_categories c
                JOIN cat_root cr ON cr.id = c.parent_id
            )
            SELECT cr.root_id,
                   ROUND(COALESCE(SUM(
                       CASE WHEN i.invoice_type = 'invoice' THEN il.line_gross_amount
                            ELSE -il.line_gross_amount END
                   ), 0)::numeric, 2) AS total_spend
            FROM cat_root cr
            JOIN products p ON p.category_id = cr.id
            JOIN supplier_products sp ON sp.product_id = p.id
            JOIN invoice_lines il ON il.supplier_product_id = sp.id
            JOIN invoices i ON i.id = il.invoice_id
            GROUP BY cr.root_id
        """).fetchall()
        spend_by_root = {r["root_id"]: float(r["total_spend"]) for r in spend_rows}

        buckets: dict[int, dict] = {}
        for row in inventory_rows:
            cat_id = row.get("category_id")
            if cat_id and cat_id in cat_to_root:
                root_id, root_name = cat_to_root[cat_id]
            else:
                continue  # skip uncategorized on breakdown
            if root_id not in buckets:
                buckets[root_id] = {
                    "id": root_id, "name": root_name,
                    "product_count": 0, "stock_value": 0.0,
                    "total_spend": spend_by_root.get(root_id, 0.0),
                    "low_stock": 0, "out_of_stock": 0,
                }
            b = buckets[root_id]
            b["product_count"] += 1
            b["stock_value"] = round(b["stock_value"] + row["stock_value"], 2)
            if row["stock_status"] == "low_stock":
                b["low_stock"] += 1
            elif row["stock_status"] == "out_of_stock":
                b["out_of_stock"] += 1

        return sorted(buckets.values(), key=lambda x: x["name"])

    def _inventory_overview_rows(self) -> list[dict]:
        rows = [dict(r) for r in self.db.execute("""
            SELECT
                p.id                     AS product_id,
                p.name                   AS product_name,
                p.category_id            AS category_id,
                p.units_per_pack         AS units_per_pack,
                p.min_stock_level        AS min_stock_level,
                COALESCE(SUM(ib.quantity), 0) AS on_hand_qty,
                uom.abbreviation         AS unit,
                COALESCE((
                    SELECT ROUND((SUM(il.quantity * il.unit_price) / NULLIF(SUM(il.quantity), 0))::numeric, 4)
                    FROM invoice_lines il
                    JOIN supplier_products sp ON sp.id = il.supplier_product_id
                    WHERE sp.product_id = p.id AND il.quantity > 0
                ), (
                    SELECT sp_price.current_price
                    FROM supplier_products sp_price
                    WHERE sp_price.product_id = p.id
                    ORDER BY sp_price.is_preferred_supplier DESC, sp_price.current_price ASC
                    LIMIT 1
                )) AS weighted_avg_cost,
                COALESCE((
                    SELECT ph.unit_price
                    FROM price_history ph
                    JOIN supplier_products sp2 ON sp2.id = ph.supplier_product_id
                    WHERE sp2.product_id = p.id
                    ORDER BY ph.effective_from DESC, ph.id DESC
                    LIMIT 1
                ), (
                    SELECT sp_price.current_price
                    FROM supplier_products sp_price
                    WHERE sp_price.product_id = p.id
                    ORDER BY sp_price.is_preferred_supplier DESC, sp_price.current_price ASC
                    LIMIT 1
                )) AS latest_cost
            FROM products p
            LEFT JOIN inventory_balances ib ON ib.product_id = p.id
            LEFT JOIN units_of_measure uom ON uom.id = p.unit_id
            LEFT JOIN product_categories pc ON pc.id = p.category_id
            WHERE p.is_active = 1
              AND COALESCE(pc.is_service, FALSE) = FALSE
            GROUP BY p.id, p.name, p.category_id, p.units_per_pack, p.min_stock_level, uom.abbreviation
            ORDER BY p.name
        """).fetchall()]

        result = []
        for row in rows:
            qty       = row["on_hand_qty"] or 0.0
            min_level = row["min_stock_level"]
            cost      = row["weighted_avg_cost"] if row["weighted_avg_cost"] is not None else (row["latest_cost"] or 0.0)
            upp       = row.get("units_per_pack")
            pack_qty  = qty / upp if upp and upp > 1 else qty
            if qty < 0:
                status = "negative"
            elif qty == 0:
                status = "out_of_stock"
            elif min_level is not None and qty <= min_level:
                status = "low_stock"
            else:
                status = "ok"
            row["stock_status"] = status
            row["stock_value"]  = round(pack_qty * cost, 4) if cost else 0.0
            row["missing_cost"] = row["weighted_avg_cost"] is None and row["latest_cost"] is None
            result.append(row)
        return result


    def get_purchases_analytics(self, granularity: str, months: int) -> dict:
        if granularity not in ('day', 'week', 'month'):
            granularity = 'month'
        months = max(0, min(months, 36))

        date_clause = "AND i.invoice_date >= (NOW() - (%s * INTERVAL '1 month'))::date" if months > 0 else ""
        base_params = (granularity,) + ((months,) if months > 0 else ()) + (granularity,)

        rows = self.db.execute(f"""
            WITH RECURSIVE cat_root AS (
                SELECT id, id AS root_id, name AS root_name
                FROM product_categories WHERE parent_id IS NULL
                UNION ALL
                SELECT c.id, cr.root_id, cr.root_name
                FROM product_categories c JOIN cat_root cr ON cr.id = c.parent_id
            )
            SELECT
                DATE_TRUNC(%s, i.invoice_date::timestamp)::date AS period,
                COALESCE(cr.root_name, 'Other') AS category,
                ROUND(SUM(
                    CASE WHEN i.invoice_type = 'invoice' THEN il.line_gross_amount
                         ELSE -il.line_gross_amount END
                )::numeric, 2) AS total_cost,
                ROUND(SUM(
                    CASE WHEN i.invoice_type = 'invoice' THEN il.line_net_amount
                         ELSE -il.line_net_amount END
                )::numeric, 2) AS net_cost,
                COUNT(DISTINCT CASE WHEN i.invoice_type = 'invoice' THEN sp.product_id END) AS product_count
            FROM invoice_lines il
            JOIN invoices i ON i.id = il.invoice_id
            LEFT JOIN supplier_products sp ON sp.id = il.supplier_product_id
            LEFT JOIN products p ON p.id = sp.product_id
            LEFT JOIN cat_root cr ON cr.id = p.category_id
            WHERE 1=1 {date_clause}
            GROUP BY DATE_TRUNC(%s, i.invoice_date::timestamp)::date,
                     COALESCE(cr.root_name, 'Other')
            ORDER BY period DESC, category
        """, base_params).fetchall()

        periods: dict = {}
        for r in rows:
            p = str(r['period'])
            if p not in periods:
                periods[p] = {'period': p, 'total_cost': 0.0, 'net_cost': 0.0, 'by_category': {}}
            cat  = r['category']
            cost = float(r['total_cost'])
            net  = float(r['net_cost'])
            cnt  = int(r['product_count'])
            periods[p]['by_category'][cat] = {'total_cost': cost, 'net_cost': net, 'product_count': cnt}
            periods[p]['total_cost'] = round(periods[p]['total_cost'] + cost, 2)
            periods[p]['net_cost']   = round(periods[p]['net_cost'] + net, 2)

        return {'rows': list(periods.values()), 'granularity': granularity, 'months': months}

    def get_unmatched_lines(self) -> list[dict]:
        rows = self.db.execute("""
            SELECT
                COALESCE(il.line_description, '—')            AS description,
                uom.abbreviation                              AS unit,
                COALESCE(NULLIF(s.trade_name,''), s.name)     AS supplier_name,
                COUNT(*)                                       AS occurrences,
                ROUND(SUM(il.line_gross_amount)::numeric, 2)  AS total_gross,
                ROUND(SUM(il.line_net_amount)::numeric, 2)    AS total_net,
                MIN(i.invoice_date::text)                     AS first_date,
                MAX(i.invoice_date::text)                     AS last_date
            FROM invoice_lines il
            JOIN invoices i ON i.id = il.invoice_id
            JOIN suppliers s ON s.id = i.supplier_id
            LEFT JOIN units_of_measure uom ON uom.id = il.unit_id
            WHERE il.supplier_product_id IS NULL
              AND i.invoice_type = 'invoice'
            GROUP BY il.line_description, uom.abbreviation, s.id, s.name, s.trade_name
            ORDER BY total_gross DESC
        """).fetchall()
        return [dict(r) for r in rows]


def get_dashboard_repo(db: DBConnection = Depends(get_db)) -> DashboardRepository:
    return DashboardRepository(db)
