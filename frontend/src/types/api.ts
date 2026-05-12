// Auto-sync these types with backend Pydantic schemas when API changes.

export interface SupplierListItem {
  id: number
  name: string
  trade_name: string | null
  vat_number: string | null
  phone: string | null
  email: string | null
  is_active: boolean
  invoice_count: number
  total_spend: number
  product_count: number
  primary_category: string | null
}

export interface SupplierStats {
  invoice_count: number
  total_spend: number
  total_net: number
  total_vat: number
  product_count: number
}

export interface SupplierDetail extends SupplierListItem {
  address: string | null
  stats: SupplierStats
  invoices: SupplierInvoiceSummary[]
  products: SupplierProductSummary[]
}

export interface SupplierInvoiceSummary {
  id: number
  invoice_number: string
  invoice_date: string
  status: string
  invoice_type: string
  net_amount: number
  vat_amount: number
  gross_amount: number
  line_count: number
}

export interface SupplierProductSummary {
  id: number
  name: string
  supplier_product_id: number
  supplier_sku: string | null
  supplier_product_name: string | null
  current_price: number | null
  total_quantity_ordered: number | null
  category: string | null
  unit: string | null
}

export interface SupplierVariantOut {
  supplier_product_id: number
  supplier_id: number
  supplier_name: string
  supplier_sku: string | null
  supplier_product_name: string | null
  current_price: number | null
  is_preferred_supplier: number
  total_quantity_ordered: number | null
}

export interface ProductListItem {
  id: number
  name: string
  description: string | null
  category_id: number | null
  category: string | null
  unit_id: number | null
  unit: string | null
  volume_ml: number | null
  abv_percent: number | null
  units_per_pack: number | null
  pack_unit_id: number | null
  pack_unit: string | null
  pack_unit_size_ml: number | null
  supplier: string | null
  supplier_product_id: number | null
  supplier_sku: string | null
  current_price: number | null
  total_quantity_ordered: number | null
}

export interface ProviderModel { id: string; label: string }
export interface ProvidersResponse {
  anthropic: { available: boolean; models: ProviderModel[] }
  gemini:    { available: boolean; models: ProviderModel[] }
}

export interface ExtractedLineItem {
  supplier_sku: string | null
  description: string
  quantity: number
  unit: string
  unit_price: number
  discount_percent: number
  line_net_amount: number
  vat_rate: number
  excise_duty_per_unit: number
  line_gross_amount: number
  location_id: number | null
}

export interface ExtractedSupplier {
  name: string
  trade_name: string | null
  vat_number: string | null
  phone: string | null
  address: string | null
}

export interface ExtractedInvoice {
  invoice_type: string
  invoice_number: string
  invoice_date: string
  supplier: ExtractedSupplier
  net_amount: number
  vat_amount: number
  excise_duty_amount: number
  gross_amount: number
  line_items: ExtractedLineItem[]
}

export interface ProductSearchResponse {
  products: ProductListItem[]
  total: number
  page: number
  per_page: number
  sort_by: string
  sort_dir: string
}

export interface ProductPickerItem {
  id: number
  name: string
  units_per_pack: number
  unit: string | null
  current_price: number
  supplier: string | null
  supplier_sku: string | null
}

export interface ProductInvoiceLine {
  id: number
  invoice_number: string
  invoice_date: string
  supplier_name: string
  quantity: number
  unit: string | null
  unit_price: number
  discount_percent: number
  line_net_amount: number
  line_gross_amount: number
}

export interface CategoryOut {
  id: number
  name: string
  parent_id: number | null
  is_service: boolean
}

export interface ServiceLineOut {
  invoice_line_id: number
  invoice_date: string
  invoice_number: string
  invoice_type: string
  supplier_name: string
  service_name: string
  category_id: number
  category_name: string
  quantity: number
  unit_price: number
  line_net_amount: number
  line_gross_amount: number
}

export interface UnitOut {
  id: number
  name: string
  abbreviation: string
}

export interface InvoiceListItem {
  id: number
  invoice_number: string
  invoice_date: string
  invoice_type: string
  status: string
  net_amount: number
  vat_amount: number
  excise_duty_amount: number
  gross_amount: number
  supplier_name: string
  line_count: number
}

export interface InvoiceLineOut {
  id: number
  supplier_product_id: number | null
  product_id: number | null
  line_description: string | null
  quantity: number
  unit: string | null
  unit_price: number
  discount_percent: number
  line_net_amount: number
  vat_rate: number
  excise_duty_per_unit: number
  line_gross_amount: number
  supplier_sku: string | null
  product_name: string | null
}

export interface InvoiceDetail extends InvoiceListItem {
  delivery_date: string | null
  notes: string | null
  pdf_path: string | null
  lines: InvoiceLineOut[]
}

export interface ImportWarning {
  sku: string | null
  existing_name: string
  invoice_name: string
  message: string
}

export interface ImportResponse {
  success: boolean
  invoice_ids: number[]
  warnings: ImportWarning[]
}

export interface DuplicateCheckResponse {
  duplicate: boolean
  existing: { id: number; invoice_date: string; supplier_name: string } | null
}

export interface ComponentIn {
  product_id:   number | null
  composite_id: number | null
  quantity: number
  unit: string | null
}

export interface RecipeCreate {
  name: string
  category: string | null
  selling_price: number | null
  servings: number
  notes: string | null
  components: ComponentIn[]
}

export interface RecipeListItem {
  id: number
  name: string
  category: string | null
  selling_price: number | null
  selling_price_takeaway: number | null
  selling_price_delivery: number | null
  servings: number
  yield_quantity: number | null
  yield_unit: string | null
  prep_time_minutes: number | null
  notes: string | null
  is_archived: boolean
  created_at: string
  product_type: string
  total_food_cost: number
  component_count: number
  max_producible: number
  margin_pct: number | null
  current_stock: number
  linked_product_id: number | null
}

export interface ComponentOut {
  id: number
  product_id:   number | null
  composite_id: number | null
  is_composite: boolean
  product_name: string
  quantity: number
  unit: string | null
  product_unit: string | null
  unit_cost: number
  component_cost: number
  stock_retail: number
  can_produce: number
}

export interface RecipeLinkItem {
  id: number
  name: string
  selling_price: number | null
  quantity: number
  unit: string | null
}

export interface RecipeDetail extends RecipeListItem {
  components: ComponentOut[]
  bottleneck: string | null
  linked_in_recipes: RecipeLinkItem[]
}

export interface ProductionBatchOut {
  id: number
  composite_product_id: number
  location_id: number
  location_name: string
  batch_size: number
  produced_at: string
  notes: string | null
  status: string
  total_food_cost: number
  cost_per_serving: number
}

export interface ProductionBatchResult {
  batch_id: number
  total_cost: number
  movements_created: number
  expected_yield: number | null
  actual_yield: number | null
}

export interface ProductBalance {
  location_id: number
  location_name: string
  quantity: number
  unit: string | null
}

export interface ProductCostMetrics {
  last_purchase_cost: number | null
  last_purchase_date: string | null
  average_cost: number | null
  min_cost_90d: number | null
  max_cost_90d: number | null
  total_purchased: number
}

export interface ProductSupplierLink {
  supplier_product_id: number
  supplier_id: number
  supplier_name: string
  supplier_sku: string | null
  current_price: number | null
  is_preferred: number
  total_ordered: number
  last_invoice_date: string | null
}

export interface ProductRecipeLink {
  recipe_id: number
  recipe_name: string
  selling_price: number | null
  quantity_needed: number
  unit: string | null
  can_produce: number
}

export interface ProductInventoryDetail {
  id: number
  name: string
  description: string | null
  category_id: number | null
  category: string | null
  unit_id: number | null
  unit: string | null
  is_active: number
  min_stock_level: number | null
  units_per_pack: number | null
  pack_unit_id: number | null
  pack_unit: string | null
  total_on_hand: number
  stock_value: number
  stock_status: 'ok' | 'low_stock' | 'out_of_stock' | 'negative'
  missing_cost: boolean
  cost: ProductCostMetrics
  balances: ProductBalance[]
  suppliers: ProductSupplierLink[]
  recipes: ProductRecipeLink[]
}

export interface MovementHistoryItem {
  id: number
  movement_type: string
  quantity: number
  unit: string | null
  location_id: number
  location_name: string
  reason: string | null
  reference_id: number | null
  reference_type: string | null
  notes: string | null
  moved_at: string
  invoice_number: string | null
  invoice_id: number | null
}

export interface MovementHistoryResponse {
  movements: MovementHistoryItem[]
  total: number
  limit: number
  offset: number
}

export interface StockLocation {
  id: number
  name: string
  sort_order: number
  is_active: number
}

export interface InventoryOverviewItem {
  product_id: number
  product_name: string
  category: string | null
  category_id: number | null
  on_hand_qty: number
  unit: string | null
  unit_id: number | null
  min_stock_level: number | null
  is_active: number
  latest_cost: number | null
  weighted_avg_cost: number | null
  stock_value: number
  preferred_supplier: string | null
  preferred_supplier_id: number | null
  stock_status: 'ok' | 'low_stock' | 'out_of_stock' | 'negative'
  missing_cost: boolean
  missing_conversion: boolean
  has_pending_receipt: boolean
}

export interface MovementWithBalance {
  id: number
  product_id: number
  product_name: string
  movement_type: string
  quantity: number
  unit: string | null
  location_id: number | null
  location_name: string | null
  reason: string | null
  reference_id: number | null
  reference_type: string | null
  notes: string | null
  moved_at: string
  invoice_number: string | null
  invoice_id: number | null
  balance_before: number
  balance_after: number
  is_voided: boolean
}

export interface GlobalMovementListResponse {
  movements: MovementWithBalance[]
  total: number
  limit: number
  offset: number
}

export interface AdjustmentResult {
  success: boolean
  warning: string | null
  current_stock: number | null
  resulting_stock: number | null
}

export interface VoidMovementResponse {
  success: boolean
  error: string | null
}

export interface CountCategoryNodeOut {
  id: number
  session_id: number
  category_id: number
  category_name: string
  display_order: number
}

export interface CountLineOut {
  id: number
  product_id: number
  product_name: string
  unit: string | null
  system_qty: number | null
  counted_qty: number | null
  variance: number | null
  notes: string | null
  category_id: number | null
  category_name: string | null
}

export interface CountSessionOut {
  id: number
  location_id: number
  location_name: string
  count_date: string | null
  counted_at: string
  frozen_at: string | null
  notes: string | null
  status: 'draft' | 'pending_approval' | 'committed'
  line_count: number
  counted_lines: number
  total_variance_items: number
}

export interface CountSessionDetail extends CountSessionOut {
  lines: CountLineOut[]
  categories: CountCategoryNodeOut[]
}

export interface CountSessionListResponse {
  sessions: CountSessionOut[]
  total: number
}

export interface PostResult {
  success: boolean
  movements_created: number
  session_id: number
}

export const WASTE_REASON_CODES = [
  'expired', 'damaged', 'overproduction', 'preparation_loss', 'breakage',
] as const
export type WasteReason = typeof WASTE_REASON_CODES[number]

export const WASTE_REASON_LABELS: Record<string, string> = {
  expired:          'Expired',
  damaged:          'Damaged',
  overproduction:   'Overproduction',
  preparation_loss: 'Preparation Loss',
  breakage:         'Breakage',
}

export interface WasteEntry {
  id: number
  product_id: number
  product_name: string
  category: string | null
  location_id: number
  location_name: string
  unit: string | null
  quantity: number
  reason: string | null
  notes: string | null
  moved_at: string
  estimated_value: number
}

export interface WasteListResponse {
  entries: WasteEntry[]
  total: number
  limit: number
  offset: number
}

export interface WasteByReason {
  reason: string | null
  count: number
  total_quantity: number
  total_value: number
}

export interface WasteTopProduct {
  product_id: number
  product_name: string
  category: string | null
  unit: string | null
  event_count: number
  total_quantity: number
  total_value: number
}

export interface WasteTrendDay {
  date: string
  event_count: number
  total_value: number
}

export interface WasteAnalytics {
  total_events: number
  total_value: number
  by_reason: WasteByReason[]
  top_products: WasteTopProduct[]
  trend: WasteTrendDay[]
}

export interface TransferLineOut {
  id: number
  product_id: number
  product_name: string
  unit: string | null
  quantity: number
  available_qty: number
  notes: string | null
}

export interface TransferOut {
  id: number
  reference_number: string
  from_location_id: number
  from_location_name: string
  to_location_id: number
  to_location_name: string
  status: 'draft' | 'confirmed' | 'cancelled'
  notes: string | null
  created_at: string
  confirmed_at: string | null
  cancelled_at: string | null
  line_count: number
}

export interface TransferDetail extends TransferOut {
  lines: TransferLineOut[]
}

export interface TransferListResponse {
  transfers: TransferOut[]
  total: number
}

export interface MainCategoryBreakdownItem {
  id: number
  name: string
  product_count: number
  stock_value: number
  total_spend: number
  low_stock: number
  out_of_stock: number
}

export interface ProductCatalogStats {
  total_active: number
  missing_cost: number
  low_stock: number
  out_of_stock: number
  stock_value: number
  pending_receipts: number
}

export interface ProductReferenceData {
  categories: CategoryOut[]
  units: UnitOut[]
  suppliers: SupplierListItem[]
  stats: ProductCatalogStats
  locations: StockLocation[]
  breakdown: MainCategoryBreakdownItem[]
}

export interface PendingReceiptOut {
  id: number
  product_id: number
  product_name: string
  location_id: number | null
  location_name: string | null
  quantity: number
  unit: string | null
  notes: string | null
  moved_at: string
}

export interface SupplierCatalogStats {
  total_suppliers: number
  total_spend: number
  total_invoices: number
  avg_spend: number
}

export interface InvoiceUpdate {
  invoice_date:   string
  invoice_number: string
  invoice_type:   'invoice' | 'credit_note'
  delivery_date:  string | null
  notes:          string | null
}

export interface InvoiceCatalogStats {
  count: number
  total_gross: number
  total_vat: number
  avg_invoice: number
}

export interface DashboardStats {
  products: number
  suppliers: number
  invoices: number
  recipes: number
  total_spend: number
  total_spend_non_fb: number
  stock_value: number
  stock_value_non_fb: number
  low_stock_products: number
  out_of_stock_products: number
  negative_stock_products: number
  missing_cost_products: number
  waste_events_30d: number
  waste_value_30d: number
  draft_transfers: number
  avg_recipe_margin_pct: number | null
  blocked_recipes: number
}

export interface UnmatchedLineItem {
  description: string
  unit: string | null
  supplier_name: string
  occurrences: number
  total_gross: number
  total_net: number
  first_date: string
  last_date: string
}

export interface PurchaseCategoryBreakdown {
  total_cost: number
  net_cost: number
  product_count: number
}

export interface PurchasePeriodRow {
  period: string
  total_cost: number
  net_cost: number
  by_category: Record<string, PurchaseCategoryBreakdown>
}

export interface PurchasesAnalyticsResponse {
  rows: PurchasePeriodRow[]
  granularity: string
  months: number
}

export interface ProductCostHistoryItem {
  invoice_date: string
  invoice_number: string
  supplier_name: string
  quantity: number
  unit: string | null
  unit_price: number
  discount_percent: number
  line_net_amount: number
  line_gross_amount: number
}

export interface DashboardData {
  stats: DashboardStats
  by_main_category: MainCategoryBreakdownItem[]
  recent_invoices: Array<{
    id: number; invoice_number: string; invoice_date: string
    gross_amount: number; supplier_name: string
  }>
  by_category: Array<{ name: string; cnt: number }>
  by_supplier: Array<{ name: string; invoices: number; total: number }>
  inventory_alerts: Array<{
    product_id: number
    product_name: string
    unit: string | null
    on_hand_qty: number
    min_stock_level: number | null
    stock_status: 'ok' | 'low_stock' | 'out_of_stock' | 'negative'
  }>
  waste_hotspots: Array<{
    product_id: number
    product_name: string
    category: string | null
    total_quantity: number
    unit: string | null
    total_value: number
  }>
  recipe_watchlist: Array<{
    id: number
    name: string
    total_food_cost: number
    selling_price: number | null
    margin_pct: number | null
    max_producible: number
    status: 'blocked' | 'low_margin'
  }>
  purchasing_snapshot: Array<{
    name: string
    invoices: number
    total: number
    last_invoice_date: string | null
  }>
}
