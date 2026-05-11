import csv
import io

from fastapi import Depends

from ..database import get_db
from ..protocols import DBConnection
from ..services.inventory_posting_service import post_movements


# WAC subquery: weighted average cost per unit for a product (all-time).
_WAC = """
    COALESCE((
        SELECT SUM(il.line_net_amount) / NULLIF(SUM(il.quantity), 0)
        FROM invoice_lines il
        JOIN supplier_products sp ON sp.id = il.supplier_product_id
        WHERE sp.product_id = sm.product_id
    ), 0)
"""


class WasteRepository:
    def __init__(self, db: DBConnection) -> None:
        self.db = db

    def list_waste(
        self,
        date_from: str | None = None,
        date_to: str | None = None,
        location_id: int | None = None,
        category_id: int | None = None,
        reason: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        where = [
            "sm.movement_type = 'waste'",
            "NOT EXISTS (SELECT 1 FROM stock_movements sv WHERE sv.reference_type='void' AND sv.reference_id=sm.id)",
        ]
        params: list = []

        if date_from:
            where.append("sm.moved_at::date >= %s")
            params.append(date_from)
        if date_to:
            where.append("sm.moved_at::date <= %s")
            params.append(date_to)
        if location_id:
            where.append("sm.location_id = %s")
            params.append(location_id)
        if category_id:
            where.append("p.category_id = %s")
            params.append(category_id)
        if reason:
            where.append("sm.reason = %s")
            params.append(reason)

        clause = " AND ".join(where)

        total = self.db.execute(f"""
            SELECT COUNT(*)
            FROM stock_movements sm
            JOIN products p ON p.id = sm.product_id
            WHERE {clause}
        """, params).fetchone()[0]

        rows = self.db.execute(f"""
            SELECT
                sm.id, sm.product_id, p.name AS product_name,
                pc.name AS category,
                sm.location_id, sl.name AS location_name,
                uom.abbreviation AS unit,
                ABS(sm.quantity) AS quantity,
                sm.reason, sm.notes, sm.moved_at,
                ROUND((ABS(sm.quantity) * {_WAC})::numeric, 4) AS estimated_value
            FROM stock_movements sm
            JOIN products p ON p.id = sm.product_id
            LEFT JOIN product_categories pc ON pc.id = p.category_id
            LEFT JOIN stock_locations sl ON sl.id = sm.location_id
            LEFT JOIN units_of_measure uom ON uom.id = sm.unit_id
            WHERE {clause}
            ORDER BY sm.moved_at DESC, sm.id DESC
            LIMIT %s OFFSET %s
        """, params + [limit, offset]).fetchall()

        return {
            "entries": [dict(r) for r in rows],
            "total": total,
            "limit": limit,
            "offset": offset,
        }

    def create_waste(
        self,
        product_id: int,
        location_id: int,
        quantity: float,
        reason: str | None,
        notes: str | None,
    ) -> dict:
        result = post_movements(self.db, [{
            "product_id": product_id,
            "location_id": location_id,
            "movement_type": "waste",
            "quantity": -quantity,
            "reason": reason,
            "notes": notes,
        }])
        if not result["success"]:
            raise ValueError("Waste would result in negative stock")
        return {"id": result["movement_ids"][0]}

    def update_reason(
        self,
        movement_id: int,
        reason: str | None,
        notes: str | None,
    ) -> bool:
        row = self.db.execute(
            "SELECT id FROM stock_movements WHERE id = %s AND movement_type = 'waste'",
            (movement_id,),
        ).fetchone()
        if not row:
            return False
        self.db.execute(
            "UPDATE stock_movements SET reason = %s, notes = %s WHERE id = %s",
            (reason, notes, movement_id),
        )
        self.db.commit()
        return True

    def get_analytics(
        self,
        date_from: str | None = None,
        date_to: str | None = None,
        location_id: int | None = None,
    ) -> dict:
        where = [
            "sm.movement_type = 'waste'",
            "NOT EXISTS (SELECT 1 FROM stock_movements sv WHERE sv.reference_type='void' AND sv.reference_id=sm.id)",
        ]
        params: list = []

        if date_from:
            where.append("sm.moved_at::date >= %s")
            params.append(date_from)
        if date_to:
            where.append("sm.moved_at::date <= %s")
            params.append(date_to)
        if location_id:
            where.append("sm.location_id = %s")
            params.append(location_id)

        clause = " AND ".join(where)

        summary = self.db.execute(f"""
            SELECT
                COUNT(*) AS total_events,
                ROUND(SUM(ABS(sm.quantity) * {_WAC})::numeric, 4) AS total_value
            FROM stock_movements sm
            JOIN products p ON p.id = sm.product_id
            WHERE {clause}
        """, params).fetchone()

        by_reason = self.db.execute(f"""
            SELECT
                sm.reason,
                COUNT(*) AS count,
                ROUND(SUM(ABS(sm.quantity))::numeric, 4) AS total_quantity,
                ROUND(SUM(ABS(sm.quantity) * {_WAC})::numeric, 4) AS total_value
            FROM stock_movements sm
            JOIN products p ON p.id = sm.product_id
            WHERE {clause}
            GROUP BY sm.reason
            ORDER BY total_value DESC
        """, params).fetchall()

        top_products = self.db.execute(f"""
            SELECT
                sm.product_id,
                p.name AS product_name,
                pc.name AS category,
                uom.abbreviation AS unit,
                COUNT(*) AS event_count,
                ROUND(SUM(ABS(sm.quantity))::numeric, 4) AS total_quantity,
                ROUND(SUM(ABS(sm.quantity) * {_WAC})::numeric, 4) AS total_value
            FROM stock_movements sm
            JOIN products p ON p.id = sm.product_id
            LEFT JOIN product_categories pc ON pc.id = p.category_id
            LEFT JOIN units_of_measure uom ON uom.id = sm.unit_id
            WHERE {clause}
            GROUP BY sm.product_id, p.name, pc.name, uom.abbreviation
            ORDER BY total_value DESC
            LIMIT 15
        """, params).fetchall()

        trend = self.db.execute(f"""
            SELECT
                sm.moved_at::date AS date,
                COUNT(*) AS event_count,
                ROUND(SUM(ABS(sm.quantity) * {_WAC})::numeric, 4) AS total_value
            FROM stock_movements sm
            JOIN products p ON p.id = sm.product_id
            WHERE {clause}
              AND sm.moved_at::date >= (NOW() - INTERVAL '30 days')::date
            GROUP BY sm.moved_at::date
            ORDER BY date ASC
        """, params).fetchall()

        return {
            "total_events": summary["total_events"] or 0,
            "total_value":  round(summary["total_value"] or 0, 4),
            "by_reason":    [dict(r) for r in by_reason],
            "top_products": [dict(r) for r in top_products],
            "trend":        [dict(r) for r in trend],
        }

    @staticmethod
    def waste_to_csv(entries: list[dict]) -> str:
        if not entries:
            return "id,moved_at,product_name,category,location_name,quantity,unit,reason,notes,estimated_value\n"
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=[
            "id", "moved_at", "product_name", "category", "location_name",
            "quantity", "unit", "reason", "notes", "estimated_value",
        ], extrasaction="ignore")
        writer.writeheader()
        writer.writerows(entries)
        return buf.getvalue()


def get_waste_repo(db: DBConnection = Depends(get_db)) -> WasteRepository:
    return WasteRepository(db)
