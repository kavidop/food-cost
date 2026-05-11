import csv
import io

from fastapi import Depends

from ..database import get_db
from ..protocols import DBConnection
from ..services.inventory_posting_service import post_movements


class MovementsRepository:
    def __init__(self, db: DBConnection) -> None:
        self.db = db

    def list_movements(
        self,
        date_from: str | None = None,
        date_to: str | None = None,
        movement_type: str | None = None,
        location_id: int | None = None,
        product_id: int | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        where = ["1=1"]
        params: list = []

        if date_from:
            where.append("sm.moved_at::date >= %s")
            params.append(date_from)
        if date_to:
            where.append("sm.moved_at::date <= %s")
            params.append(date_to)
        if movement_type:
            where.append("sm.movement_type = %s")
            params.append(movement_type)
        if location_id:
            where.append("sm.location_id = %s")
            params.append(location_id)
        if product_id:
            where.append("sm.product_id = %s")
            params.append(product_id)

        total = self.db.execute(
            f"SELECT COUNT(*) FROM stock_movements sm WHERE {' AND '.join(where)}",
            params,
        ).fetchone()[0]

        rows = self.db.execute(f"""
            SELECT
                sm.id,
                sm.product_id,
                p.name              AS product_name,
                sm.movement_type,
                sm.quantity,
                uom.abbreviation    AS unit,
                sm.location_id,
                sl.name             AS location_name,
                sm.reason,
                sm.reference_id,
                sm.reference_type,
                sm.notes,
                sm.moved_at,
                CASE WHEN sm.reference_type = 'invoice_line' THEN (
                    SELECT i.invoice_number
                    FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id
                    WHERE il.id = sm.reference_id
                ) ELSE NULL END AS invoice_number,
                CASE WHEN sm.reference_type = 'invoice_line' THEN (
                    SELECT i.id
                    FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id
                    WHERE il.id = sm.reference_id
                ) ELSE NULL END AS invoice_id,
                (
                    SELECT COALESCE(SUM(sm2.quantity), 0)
                    FROM stock_movements sm2
                    WHERE sm2.product_id = sm.product_id
                      AND sm2.location_id = sm.location_id
                      AND sm2.id < sm.id
                ) AS balance_before,
                EXISTS (
                    SELECT 1 FROM stock_movements sv
                    WHERE sv.reference_type = 'void' AND sv.reference_id = sm.id
                ) AS is_voided
            FROM stock_movements sm
            JOIN products p ON p.id = sm.product_id
            LEFT JOIN stock_locations sl ON sl.id = sm.location_id
            LEFT JOIN units_of_measure uom ON uom.id = sm.unit_id
            WHERE {' AND '.join(where)}
            ORDER BY sm.moved_at DESC, sm.id DESC
            LIMIT %s OFFSET %s
        """, params + [limit, offset]).fetchall()

        result = []
        for r in rows:
            row = dict(r)
            row["balance_after"]  = round(row["balance_before"] + row["quantity"], 4)
            row["balance_before"] = round(row["balance_before"], 4)
            row["is_voided"]      = bool(row["is_voided"])
            result.append(row)

        return {
            "movements": result,
            "total":  total,
            "limit":  limit,
            "offset": offset,
        }

    def receive_stock(
        self,
        product_id: int,
        location_id: int,
        quantity: float,
        notes: str | None,
    ) -> None:
        post_movements(self.db, [{
            "product_id": product_id,
            "location_id": location_id,
            "movement_type": "purchase_receipt",
            "quantity": quantity,
            "notes": notes,
        }])

    def create_adjustment(
        self,
        product_id: int,
        location_id: int,
        direction: str,
        quantity: float,
        reason: str | None,
        notes: str | None,
        allow_negative: bool = False,
    ) -> dict:
        signed_qty = quantity if direction == "up" else -quantity
        movement_type = "adjustment_up" if direction == "up" else "adjustment_down"
        result = post_movements(
            self.db,
            [{
                "product_id": product_id,
                "location_id": location_id,
                "movement_type": movement_type,
                "quantity": signed_qty,
                "reason": reason,
                "notes": notes,
            }],
            allow_negative=allow_negative,
        )
        if not result["success"]:
            return result
        return {"success": True, "warning": None, "current_stock": None, "resulting_stock": None}

    def void_movement(self, movement_id: int) -> dict:
        original = self.db.execute(
            "SELECT * FROM stock_movements WHERE id = %s", (movement_id,)
        ).fetchone()
        if not original:
            return {"success": False, "error": "not_found"}

        original = dict(original)

        already_voided = self.db.execute(
            "SELECT COUNT(*) FROM stock_movements WHERE reference_type='void' AND reference_id=%s",
            (movement_id,),
        ).fetchone()[0]
        if already_voided:
            return {"success": False, "error": "already_voided"}

        counter_qty  = -original["quantity"]
        counter_type = "adjustment_up" if counter_qty > 0 else "adjustment_down"

        post_movements(self.db, [{
            "product_id": original["product_id"],
            "location_id": original["location_id"],
            "movement_type": counter_type,
            "quantity": counter_qty,
            "unit_id": original["unit_id"],
            "reference_type": "void",
            "reference_id": movement_id,
            "notes": f"Void of movement #{movement_id}",
        }])

        return {"success": True}

    def receive_pending(
        self,
        product_id: int,
        location_id: int,
        quantity: float,
        notes: str | None,
    ) -> None:
        post_movements(self.db, [{
            "product_id": product_id,
            "location_id": location_id,
            "movement_type": "receipt_pending",
            "quantity": quantity,
            "notes": notes,
        }])

    def get_pending_receipts(self, product_id: int | None = None) -> list[dict]:
        where = [
            "sm.movement_type = 'receipt_pending'",
            "sm.reference_id IS NULL",
            "NOT EXISTS (SELECT 1 FROM stock_movements sv WHERE sv.reference_type = 'void' AND sv.reference_id = sm.id)",
        ]
        params: list = []
        if product_id:
            where.append("sm.product_id = %s")
            params.append(product_id)

        rows = self.db.execute(f"""
            SELECT sm.id, sm.product_id, p.name AS product_name,
                   sm.location_id, sl.name AS location_name,
                   sm.quantity, uom.abbreviation AS unit,
                   sm.notes, sm.moved_at
            FROM stock_movements sm
            JOIN products p ON p.id = sm.product_id
            LEFT JOIN stock_locations sl ON sl.id = sm.location_id
            LEFT JOIN units_of_measure uom ON uom.id = sm.unit_id
            WHERE {' AND '.join(where)}
            ORDER BY sm.moved_at DESC
        """, params if params else None).fetchall()
        return [dict(r) for r in rows]

    def link_to_invoice_line(self, movement_id: int, invoice_line_id: int) -> dict:
        mov = self.db.execute(
            "SELECT id, movement_type, reference_id FROM stock_movements WHERE id = %s",
            (movement_id,),
        ).fetchone()
        if not mov:
            return {"success": False, "error": "not_found"}
        if mov["movement_type"] != "receipt_pending":
            return {"success": False, "error": "not_pending"}
        if mov["reference_id"] is not None:
            return {"success": False, "error": "already_linked"}

        self.db.execute(
            "UPDATE stock_movements SET reference_id = %s, reference_type = 'invoice_line' WHERE id = %s",
            (invoice_line_id, movement_id),
        )
        self.db.commit()
        return {"success": True}

    @staticmethod
    def movements_to_csv(rows: list[dict]) -> str:
        if not rows:
            return "id,moved_at,product_name,movement_type,quantity,unit,location_name,balance_before,balance_after,reason,notes\n"
        buf = io.StringIO()
        fieldnames = [
            "id", "moved_at", "product_name", "movement_type", "quantity", "unit",
            "location_name", "balance_before", "balance_after", "reason", "notes",
        ]
        writer = csv.DictWriter(buf, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
        return buf.getvalue()


def get_movements_repo(db: DBConnection = Depends(get_db)) -> MovementsRepository:
    return MovementsRepository(db)
