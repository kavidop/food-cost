# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working Protocol
- Always read this file before starting any task
- Propose a plan identifying which files are involved before reading or editing them
- Wait for user approval before proceeding
- Only read files that are part of the approved plan

## Commands

```bash
npm run dev      # dev server on :5173 — proxies /api to http://localhost:8000
npm run build    # tsc -b && vite build
npx tsc --noEmit # type-check without building (use this — npm run lint is broken)
```

> `npm run lint` fails with an ESLint v9 config-not-found error (pre-existing, unrelated to app code). Use `npx tsc --noEmit` to verify types instead.

## Stack

React 18, TypeScript, Vite, React Router v6, lucide-react (icons). No component library — all styling is inline `style={}`. `@` resolves to `src/`.

## Pages (one file per route)

| Route | Page file | Nav section |
|---|---|---|
| `/` | Dashboard | Overview |
| `/import` | Import | Overview |
| `/purchases` | Purchases | Overview |
| `/inventory` | Inventory | Inventory Ops |
| `/inventory/:productId` | InventoryDetail | — |
| `/movements` | Movements | Inventory Ops |
| `/stock-count` | StockCount | Inventory Ops |
| `/stock-count/:sessionId` | StockCountDetail | — |
| `/transfers` | Transfers | Inventory Ops |
| `/waste` | Waste | Inventory Ops |
| `/products` | Products | Catalog |
| `/categories` | Categories | Catalog |
| `/suppliers` | Suppliers | Catalog |
| `/invoices` | Invoices | Catalog |
| `/recipes` | Recipes | Production |
| `/intermediate-products` | IntermediateProducts | Production |

Adding a page: create `src/pages/Foo.tsx`, import it in `App.tsx`, add a `<Route>` and a nav entry to `NAV_SECTIONS`.

## Sidebar (`App.tsx`)

`NAV_SECTIONS` is the single source of truth for the nav. Each entry has `label`, `sectionIcon` (Lucide element), and `links` (array of `{ to, label, icon }`). The sidebar is collapsible per section — clicking the section header toggles it. On first render, the section containing the current route is auto-expanded. Import icons from `lucide-react`.

## Data fetching hooks

**`useQuery(fn, deps?)`** — auto-runs on mount and when deps change. Returns `{data, loading, error, reload}`. Import from `@/hooks/useAsync`.

**`useMutation(fn)`** — returns `{mutate, loading, error, reset}`. The `fnRef` pattern means inline arrow functions are safe. Call as `mutate(args)` or `mutate(undefined as void)` for void mutations.

## API client (`src/api/client.ts`)

All calls go through `request<T>(path, init?)`:
- Sets `Content-Type: application/json` unless body is `FormData`
- Throws `Error(detail)` on non-2xx

For file downloads use raw `fetch` — `request<T>` always calls `.json()`.

Key API groups and their functions:

**Recipes** (final composite products, `product_type='composite'`):
`getRecipes`, `getRecipe`, `createRecipe`, `updateRecipe`, `duplicateRecipe`, `archiveRecipe`, `deleteRecipe`
— `getRecipes()` passes `product_type=composite` so intermediates are excluded.

**Intermediate Products** (`product_type='intermediate'`):
`getIntermediateProducts`, `getIntermediateProduct`, `createIntermediateProduct`, `updateIntermediateProduct`, `produceIntermediateBatch(id, {location_id, batch_size, actual_yield?, notes?})`, `getProductionBatches(id)`
— `createIntermediateProduct` / `updateIntermediateProduct` automatically inject `product_type: 'intermediate'`.

**Invoices**: `getInvoices({ supplier_id?, date_from?, date_to?, sort_by?, sort_dir? })`, `getInvoice(id)`, `deleteInvoice(id)`, `updateInvoice(id, data: InvoiceUpdate)`, `suggestLocations(descriptions: string[])`
— All params optional; omitting them returns the full list sorted by date desc.
— `net_amount`/`vat_amount`/`gross_amount` in list response are sums of `invoice_lines`, not invoice header values.
— `updateInvoice` calls `PATCH /invoices/{id}` to correct AI-misextracted fields (date, number, type, delivery date, notes).
— `suggestLocations` calls `POST /import/suggest-locations`: returns `{ suggestions: (number | null)[] }` based on existing inventory for each product name.

**Purchases**: `getPurchasesAnalytics(granularity, months)`, `getUnmatchedLines()`
— `granularity`: `'day' | 'week' | 'month'`; `months`: 0 = all time, else last N months.
— Returns spend by period × root category (Total, Food, Beverage, Non-Food, Other).
— `getUnmatchedLines()` returns invoice lines with no product catalog match.

**Inventory**: `getStockLocations`, `getInventoryOverview`, `getProductDetail`, `adjustStock`, `recordWaste`, `transferStock`, `exportInventoryOverview(params)`, `setStockThreshold(id, min)`
— `getProductDetail` now includes `pack_unit`, `pack_unit_id`. Balances normalized to retail units.
— Cost Metrics display uses `pack_unit` for "Total qty purchased" when available.
— Total On Hand tile shows pack breakdown sub-text (e.g. "600 btl / 25 kbt").

**Movements**: `listMovements`, `createAdjustment`, `receiveStock`, `voidMovement`, `receivePending`, `getPendingReceipts(productId?)`, `linkReceiptToInvoiceLine(movementId, invoiceLineId)`

**Products**: `getProductStats`, `createProduct`, `searchProducts`, `updateProduct`, `mergeProducts`
— `getProductReferenceData()` returns `{categories, units, suppliers, stats, locations}` in one call (replaces 5 separate fetches on the Products page).

**Stock Count**: `listCountSessions`, `createCountSession`, `getCountSession`, `updateCountLines`, `submitCountSession`, `approveCountSession`, `updateCountDate(id, count_date)`, `refreshCountSession(id)`
— `refreshCountSession` re-syncs `system_qty` from current inventory balances (adds products transferred in, updates existing quantities). Only works in draft.

**Transfers**: `listTransfers`, `createTransfer`, `getTransfer`, `confirmTransfer`, `cancelTransfer`

**Waste**: `listWaste`, `createWaste`, `updateWasteReason`, `getWasteAnalytics`

## Types (`src/types/api.ts`)

Single source of truth for API shapes — keep in sync with backend Pydantic schemas manually.

Notable types:
- `RecipeListItem` — includes `product_type`, `current_stock`, `linked_product_id`
- `RecipeDetail` — extends `RecipeListItem` with `components`, `bottleneck`, `linked_in_recipes`
- `ProductionBatchOut` — batch history row
- `ProductionBatchResult` — response from `produceIntermediateBatch`
- `PendingReceiptOut` — unlinked `receipt_pending` movement (no invoice yet)
- `ProductCatalogStats` — includes `pending_receipts` count
- `InventoryOverviewItem` — includes `has_pending_receipt: boolean` (amber warning dot in UI)
- `InvoiceLineOut` — includes `product_id` (resolved via `supplier_products`)
- `InvoiceUpdate` — `{ invoice_date, invoice_number, invoice_type, delivery_date?, notes? }` for PATCH
- `CountSessionOut` — includes `count_date: string | null` (editable while not committed)
- `ProductInventoryDetail` — includes `pack_unit_id`, `pack_unit`, `units_per_pack`. `total_on_hand` always in retail units; balances normalized.
- `ProductReferenceData` — batched response from `/products/reference-data`: `{categories, units, suppliers, stats, locations}`
- `ExtractedLineItem` — includes `location_id: number | null` (mandatory on import; set via per-invoice default or per-line override)
- `ProductCostHistoryItem` — invoice line for a product with `invoice_date`, `supplier_name`, `unit_price`, `line_gross_amount`, etc.
- `PurchasesAnalyticsResponse` — `{ periods: PurchasePeriodRow[], summary: PurchaseCategoryBreakdown[] }`
- `UnmatchedLineItem` — invoice line with no `supplier_product_id`

## Spend total convention

All spend totals in the UI negate credit notes:
```ts
const sign = (i: { invoice_type: string }) => i.invoice_type === 'credit_note' ? -1 : 1
const total = rows.reduce((s, i) => s + sign(i) * i.gross_amount, 0)
```
Backend returns raw positive amounts for credit notes; sign flip is applied consistently in every reducer.

## UI conventions

- z-index: backdrop 40, slide-over panel 50, modal 60+ (detail + produce modal stack: 40/50 + 60/70)
- Currency: `n.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })`
- Mutation errors displayed inline near the triggering button, not via `alert()`
- Slide-in detail panels: `position: fixed`, right side, 580–620px wide
- Centered modals: `position: fixed`, `top: 3%`, `transform: translateX(-50%)`, `maxWidth: 820px`
- Small modals (e.g. produce batch): `top: 50%`, `transform: translate(-50%,-50%)`, `maxWidth: 460px`

## Session Closing Protocol

When told to 'wrap up': update the Pages table and any changed API functions/types above to reflect changes from the session. Do not scan the repo — work from conversation context. Keep this file under 300 lines.
