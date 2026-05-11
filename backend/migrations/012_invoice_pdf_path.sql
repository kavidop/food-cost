-- Add pdf_path column to invoices (table recreation — ALTER TABLE ADD COLUMN is not idempotent)
PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS invoices_new (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id          INTEGER NOT NULL REFERENCES suppliers(id),
    invoice_number       TEXT    NOT NULL,
    invoice_date         TEXT    NOT NULL,
    delivery_date        TEXT,
    net_amount           REAL    NOT NULL DEFAULT 0,
    vat_amount           REAL    NOT NULL DEFAULT 0,
    excise_duty_amount   REAL    NOT NULL DEFAULT 0,
    gross_amount         REAL    NOT NULL DEFAULT 0,
    currency             TEXT    NOT NULL DEFAULT 'EUR',
    status               TEXT    NOT NULL DEFAULT 'received'
                             CHECK (status IN ('received','verified','posted','disputed')),
    notes                TEXT,
    pdf_path             TEXT,
    created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (supplier_id, invoice_number)
);

INSERT OR IGNORE INTO invoices_new
    SELECT id, supplier_id, invoice_number, invoice_date, delivery_date,
           net_amount, vat_amount, excise_duty_amount, gross_amount,
           currency, status, notes, NULL AS pdf_path, created_at
    FROM invoices;

DROP TABLE invoices;
ALTER TABLE invoices_new RENAME TO invoices;

PRAGMA foreign_keys = ON;
