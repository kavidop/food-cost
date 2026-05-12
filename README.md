# Zubro Food Cost

A food and beverage cost management system for restaurants and food service operations. Tracks inventory, supplier invoices, recipe costs, waste, and stock across locations — with AI-powered PDF invoice extraction.

## Features

- **Dashboard** — KPIs, spending trends, and pending tasks at a glance; includes Services & Fees spend tile
- **Invoice Import** — Extract line items from supplier PDF invoices using Claude or Gemini AI
- **Inventory** — Real-time stock overview by location with movement ledger and product search
- **Stock Counts** — Physical inventory sessions with system reconciliation; supports category-based grouping with collapsible sections
- **Transfers** — Move stock between locations with confirmation workflow
- **Waste Tracking** — Log and analyse waste by location and reason
- **Recipes** — Bill-of-materials costing with production batch recording
- **Intermediate Products** — Prep items (syrups, sauces) with their own production batches
- **Purchases Analytics** — Spend breakdown by category and time period
- **Supplier & Product Catalog** — Master data management with merge/deduplication; products can be deleted when unlinked from invoices
- **Services & Guarantees** — Dedicated view for non-inventory invoice lines (fees, services, guarantees) filtered by service categories

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite |
| Backend | FastAPI (Python 3.11) + Uvicorn |
| Database | PostgreSQL (Supabase) — SQLite fallback for local dev |
| AI / PDF | Anthropic Claude API + Google Gemini API |
| Testing | pytest |
| Deployment | Docker (multi-stage build) |

## Project Structure

```
food-cost-app/
├── backend/
│   ├── app/
│   │   ├── routes/          # HTTP controllers (thin)
│   │   ├── repositories/    # All SQL and business logic
│   │   ├── services/        # Inventory posting + AI PDF extraction
│   │   ├── schemas/         # Pydantic request/response models
│   │   ├── domain/          # Business rules (units, matching, categories)
│   │   ├── main.py          # FastAPI app factory
│   │   ├── database.py      # Connection pool
│   │   └── config.py        # Settings from env vars
│   ├── migrations/          # Numbered SQL migrations
│   ├── tests/               # pytest suite (in-memory SQLite)
│   ├── requirements.txt
│   └── run.py               # Dev server entry point
├── frontend/
│   ├── src/
│   │   ├── pages/           # One file per route
│   │   ├── components/      # Reusable UI components
│   │   ├── hooks/           # useAsync, useMutation
│   │   ├── api/client.ts    # All typed API calls
│   │   └── App.tsx          # App shell + sidebar navigation
│   ├── vite.config.ts       # Proxies /api → localhost:8000
│   └── package.json
├── Dockerfile               # Multi-stage: Node build + Python runtime
└── webapp/                  # DEPRECATED legacy Flask app (reference only)
```

## Getting Started

### Prerequisites

- Python 3.11+
- Node 20+
- PostgreSQL (optional — SQLite is used automatically if `DATABASE_URL` is not set)

### Backend

```bash
cd backend
pip install -r requirements.txt

# Copy and fill in your environment variables
cp .env.example .env

python run.py        # API server on http://localhost:8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev          # Dev server on http://localhost:5173
```

During development the Vite dev server proxies `/api/*` requests to `http://localhost:8000`, so both servers need to be running.

### Docker

```bash
docker build -t zubro-food-cost .
docker run -p 8000:8000 \
  -e DATABASE_URL=postgresql://... \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  zubro-food-cost
```

The container builds the frontend, then serves it alongside the API on port 8000.

## Environment Variables

Create `backend/.env`:

```env
# Required for AI-powered PDF invoice extraction
ANTHROPIC_API_KEY=sk-ant-api03-...

# Optional fallback AI provider
GOOGLE_API_KEY=...

# PostgreSQL connection string — omit to use SQLite
DATABASE_URL=postgresql://user:password@host:5432/dbname

# Connection pool size (optional)
DB_POOL_MIN=2
DB_POOL_MAX=10

# Additional CORS origins, comma-separated (optional)
ALLOWED_ORIGINS=https://your-app.example.com
```

## Running Tests

```bash
cd backend
python -m pytest
```

Tests run against an in-memory SQLite database. Test files cover invoice import, product matching, recipe cost calculation, inventory posting, and invoice deletion with ledger rollback.

## Database Migrations

Migrations live in `backend/migrations/` and are numbered sequentially (`001_initial.sql`, `002_composite_products.sql`, …). Run them in order against your PostgreSQL database, or use the migration runner:

```bash
cd backend
python migrations/runner.py
```

The authoritative schema is also available as `backend/schema_postgres.sql`.

## Architecture Notes

- **Repository pattern** — all SQL lives in `repositories/`; routes are thin HTTP controllers with no business logic.
- **Append-only ledger** — `stock_movements` is never updated or deleted; `inventory_balances` is a denormalised sum. Invoice deletion rolls back ledger entries rather than deleting rows.
- **Unit normalisation** — products carry both a retail unit and an optional pack unit; all displayed quantities are normalised to the retail unit.
- **AI PDF extraction** — `/api/extract` sends invoice PDFs to Claude (primary) or Gemini (fallback) and returns structured line items ready to import.

## API

All endpoints are prefixed with `/api`. Key resource groups:

| Prefix | Description |
|--------|-------------|
| `/dashboard` | KPIs and spend analytics |
| `/products` | Product catalog, search, merge |
| `/invoices` | Invoice list, detail, edit, delete |
| `/import-invoice` | Import line items and create invoice |
| `/extract` | AI PDF extraction |
| `/inventory` | Stock overview, movements, adjustments |
| `/movements` | Global ledger, CSV export |
| `/stock-count` | Physical count sessions |
| `/transfers` | Inter-location transfers |
| `/waste` | Waste log and analytics |
| `/composite-products` | Recipes and intermediate products |
| `/suppliers` | Supplier directory and stats |
| `/categories` | Category tree (supports `is_service` flag) |
| `/services` | Service & guarantee invoice lines |

Full endpoint list is documented in `backend/CLAUDE.md`.
