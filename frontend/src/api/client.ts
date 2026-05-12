import type {
  SupplierListItem, SupplierDetail,
  ProductSearchResponse, ProductPickerItem, ProductListItem, ProductInvoiceLine, ProductCatalogStats,
  ProductReferenceData, SupplierVariantOut,
  CategoryOut, UnitOut,
  InvoiceListItem, InvoiceDetail, ImportResponse, DuplicateCheckResponse, InvoiceUpdate,
  RecipeListItem, RecipeDetail,
  ProductionBatchOut, ProductionBatchResult,
  DashboardData, ProvidersResponse, ExtractedInvoice,
  StockLocation, InventoryOverviewItem,
  ProductInventoryDetail, MovementHistoryResponse,
  GlobalMovementListResponse, AdjustmentResult, VoidMovementResponse,
  PendingReceiptOut,
  CountSessionListResponse, CountSessionDetail, PostResult, CountCategoryNodeOut, ServiceLineOut,
  WasteListResponse, WasteAnalytics,
  TransferListResponse, TransferDetail,
  PurchasesAnalyticsResponse, ProductCostHistoryItem, UnmatchedLineItem,
} from '@/types/api'

const BASE = '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: isFormData
      ? init?.headers
      : { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? err.error ?? res.statusText)
  }
  if (res.status === 204) return undefined as unknown as T
  return res.json()
}

// ── Providers ─────────────────────────────────────────────────────────────

export const getProviders = () => request<ProvidersResponse>('/providers')

// ── Dashboard ──────────────────────────────────────────────────────────────

export const getDashboard = () => request<DashboardData>('/dashboard')

export const getPurchasesAnalytics = (granularity: string, months: number) =>
  request<PurchasesAnalyticsResponse>(`/purchases/analytics?granularity=${granularity}&months=${months}`)

export const getUnmatchedLines = () =>
  request<UnmatchedLineItem[]>('/purchases/unmatched-lines')

// ── Suppliers ──────────────────────────────────────────────────────────────

export const getSuppliers  = () => request<SupplierListItem[]>('/suppliers')
export const getSupplier   = (id: number) => request<SupplierDetail>(`/suppliers/${id}`)
export const updateSupplier = (id: number, data: object) =>
  request(`/suppliers/${id}`, { method: 'PUT', body: JSON.stringify(data) })
export const deleteSupplier = (id: number) =>
  request(`/suppliers/${id}`, { method: 'DELETE' })
export const mergeSupplier  = (id: number, target_id: number) =>
  request(`/suppliers/${id}/merge`, { method: 'POST', body: JSON.stringify({ target_id }) })

// ── Products ───────────────────────────────────────────────────────────────

export const getProductStats = () => request<ProductCatalogStats>('/products/stats')

export const getProductReferenceData = () => request<ProductReferenceData>('/products/reference-data')

export const getServiceLines = (params: {
  category_id?: number; supplier_id?: number; date_from?: string; date_to?: string
} = {}) => {
  const qs = new URLSearchParams()
  if (params.category_id) qs.set('category_id', String(params.category_id))
  if (params.supplier_id) qs.set('supplier_id', String(params.supplier_id))
  if (params.date_from)   qs.set('date_from', params.date_from)
  if (params.date_to)     qs.set('date_to', params.date_to)
  const q = qs.toString()
  return request<ServiceLineOut[]>(`/services/lines${q ? `?${q}` : ''}`)
}

export const createProduct = (data: object) =>
  request<{ id: number }>('/products', { method: 'POST', body: JSON.stringify(data) })

export const searchProducts = (params: Record<string, string | number>) =>
  request<ProductSearchResponse>(`/products/search?${new URLSearchParams(params as Record<string, string>)}`)

export const getAllProducts = (excludeCategoryId?: number) => {
  const qs = excludeCategoryId ? `?exclude_category_id=${excludeCategoryId}` : ''
  return request<ProductPickerItem[]>(`/products/all${qs}`)
}

export const getProduct = (id: number) =>
  request<ProductListItem>(`/products/${id}`)

export const getProductInvoices = (id: number) =>
  request<ProductInvoiceLine[]>(`/products/${id}/invoices`)

export const getProductCostHistory = (id: number) =>
  request<ProductCostHistoryItem[]>(`/products/${id}/cost-history`)

export const updateProduct = (id: number, data: object) =>
  request(`/products/${id}`, { method: 'PUT', body: JSON.stringify(data) })

export const mergeProducts = (sourceId: number, targetId: number) =>
  request(`/products/${sourceId}/merge`, { method: 'POST', body: JSON.stringify({ target_product_id: targetId }) })

export const deleteProduct = (id: number) =>
  request(`/products/${id}`, { method: 'DELETE' })

export const getProductSupplierVariants = (id: number) =>
  request<SupplierVariantOut[]>(`/products/${id}/supplier-variants`)

export const updateSupplierVariant = (
  productId: number,
  spId: number,
  data: { supplier_sku?: string | null; supplier_product_name?: string | null; is_preferred_supplier?: number },
) => request(`/products/${productId}/supplier-variants/${spId}`, {
  method: 'PATCH',
  body: JSON.stringify(data),
})

// ── Categories & Units ─────────────────────────────────────────────────────

export const getCategories   = () => request<CategoryOut[]>('/categories')
export const createCategory  = (data: object) =>
  request<CategoryOut>('/categories', { method: 'POST', body: JSON.stringify(data) })
export const updateCategory  = (id: number, data: object) =>
  request<CategoryOut>(`/categories/${id}`, { method: 'PUT', body: JSON.stringify(data) })
export const deleteCategory  = (id: number) =>
  request(`/categories/${id}`, { method: 'DELETE' })

export const getUnits = () => request<UnitOut[]>('/units')

// ── Invoices ───────────────────────────────────────────────────────────────

export const getInvoices = (params: {
  supplier_id?: number | ''
  date_from?: string
  date_to?: string
  sort_by?: string
  sort_dir?: string
} = {}) => {
  const qs = new URLSearchParams()
  if (params.supplier_id) qs.set('supplier_id', String(params.supplier_id))
  if (params.date_from)   qs.set('date_from',   params.date_from)
  if (params.date_to)     qs.set('date_to',     params.date_to)
  if (params.sort_by)     qs.set('sort_by',     params.sort_by)
  if (params.sort_dir)    qs.set('sort_dir',    params.sort_dir)
  const q = qs.toString()
  return request<InvoiceListItem[]>(`/invoices${q ? `?${q}` : ''}`)
}
export const getInvoice      = (id: number) => request<InvoiceDetail>(`/invoices/${id}`)
export const updateInvoice = (id: number, data: InvoiceUpdate) =>
  request(`/invoices/${id}`, { method: 'PATCH', body: JSON.stringify(data) })

export const deleteInvoice   = (id: number) =>
  request(`/invoices/${id}`, { method: 'DELETE' })

export const checkDuplicate  = (vat: string, invoice_number: string) =>
  request<DuplicateCheckResponse>(
    `/invoices/check-duplicate?vat=${encodeURIComponent(vat)}&invoice_number=${encodeURIComponent(invoice_number)}`
  )

export const importInvoices  = (data: object) =>
  request<ImportResponse>('/import-invoice', { method: 'POST', body: JSON.stringify(data) })

export const suggestLocations = (descriptions: string[]) =>
  request<{ suggestions: (number | null)[] }>('/import/suggest-locations', {
    method: 'POST', body: JSON.stringify({ descriptions }),
  })

export const extractPdf = (file: File, provider: string, model: string) => {
  const form = new FormData()
  form.append('file', file)
  form.append('provider', provider)
  form.append('model', model)
  return request<{ invoices: ExtractedInvoice[] }>('/extract', { method: 'POST', body: form })
}

export const attachInvoicePdf = (file: File, invoiceIds: number[]) => {
  const form = new FormData()
  form.append('file', file)
  form.append('invoice_ids', invoiceIds.join(','))
  return request<{ pdf_path: string }>('/invoices/attach-pdf', { method: 'POST', body: form })
}

// ── Inventory ──────────────────────────────────────────────────────────────

export const getStockLocations = () => request<StockLocation[]>('/inventory/locations')

export const createLocation = (body: { name: string; sort_order?: number }) =>
  request<StockLocation>('/inventory/locations', { method: 'POST', body: JSON.stringify(body) })

export const updateLocation = (id: number, body: { name?: string; sort_order?: number; is_active?: number }) =>
  request<StockLocation>(`/inventory/locations/${id}`, { method: 'PUT', body: JSON.stringify(body) })

type OverviewParams = {
  location_id?: number | ''
  category_id?: number | ''
  supplier_id?: number | ''
  low_stock_only?: boolean
  include_inactive?: boolean
}

export const getInventoryOverview = (params: OverviewParams = {}) => {
  const qs = new URLSearchParams()
  if (params.location_id)      qs.set('location_id',      String(params.location_id))
  if (params.category_id)      qs.set('category_id',      String(params.category_id))
  if (params.supplier_id)      qs.set('supplier_id',      String(params.supplier_id))
  if (params.low_stock_only)   qs.set('low_stock_only',   'true')
  if (params.include_inactive) qs.set('include_inactive', 'true')
  return request<InventoryOverviewItem[]>(`/inventory/overview?${qs}`)
}

export const exportInventoryOverview = async (params: OverviewParams = {}) => {
  const qs = new URLSearchParams()
  if (params.location_id)      qs.set('location_id',      String(params.location_id))
  if (params.category_id)      qs.set('category_id',      String(params.category_id))
  if (params.supplier_id)      qs.set('supplier_id',      String(params.supplier_id))
  if (params.low_stock_only)   qs.set('low_stock_only',   'true')
  if (params.include_inactive) qs.set('include_inactive', 'true')
  const res = await fetch(`/api/inventory/overview/export?${qs}`)
  if (!res.ok) throw new Error('Export failed')
  const blob = await res.blob()
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = 'inventory_overview.csv'
  a.click()
  URL.revokeObjectURL(url)
}

export const getProductDetail = (id: number) =>
  request<ProductInventoryDetail>(`/inventory/${id}`)

export const getProductMovements = (
  id: number,
  params: { location_id?: number; movement_type?: string; limit?: number; offset?: number } = {},
) => {
  const qs = new URLSearchParams()
  if (params.location_id)   qs.set('location_id',   String(params.location_id))
  if (params.movement_type) qs.set('movement_type', params.movement_type)
  if (params.limit)         qs.set('limit',         String(params.limit))
  if (params.offset)        qs.set('offset',        String(params.offset))
  return request<MovementHistoryResponse>(`/inventory/${id}/movements?${qs}`)
}

export const adjustStock = (id: number, body: object) =>
  request(`/inventory/${id}/adjust`, { method: 'POST', body: JSON.stringify(body) })

export const recordWaste = (id: number, body: object) =>
  request(`/inventory/${id}/waste`, { method: 'POST', body: JSON.stringify(body) })

export const transferStock = (id: number, body: object) =>
  request(`/inventory/${id}/transfer`, { method: 'POST', body: JSON.stringify(body) })

export const setStockThreshold = (id: number, min_stock_level: number | null) =>
  request(`/inventory/${id}/threshold`, { method: 'PUT', body: JSON.stringify({ min_stock_level }) })

// ── Movements ─────────────────────────────────────────────────────────────

type MovementsParams = {
  date_from?: string
  date_to?: string
  movement_type?: string
  location_id?: number | ''
  product_id?: number | ''
  limit?: number
  offset?: number
}

export const listMovements = (params: MovementsParams = {}) => {
  const qs = new URLSearchParams()
  if (params.date_from)     qs.set('date_from',     params.date_from)
  if (params.date_to)       qs.set('date_to',       params.date_to)
  if (params.movement_type) qs.set('movement_type', params.movement_type)
  if (params.location_id)   qs.set('location_id',   String(params.location_id))
  if (params.product_id)    qs.set('product_id',    String(params.product_id))
  if (params.limit)         qs.set('limit',         String(params.limit))
  if (params.offset)        qs.set('offset',        String(params.offset))
  return request<GlobalMovementListResponse>(`/movements?${qs}`)
}

export const exportMovements = async (params: MovementsParams = {}) => {
  const qs = new URLSearchParams()
  if (params.date_from)     qs.set('date_from',     params.date_from)
  if (params.date_to)       qs.set('date_to',       params.date_to)
  if (params.movement_type) qs.set('movement_type', params.movement_type)
  if (params.location_id)   qs.set('location_id',   String(params.location_id))
  if (params.product_id)    qs.set('product_id',    String(params.product_id))
  const res = await fetch(`/api/movements/export?${qs}`)
  if (!res.ok) throw new Error('Export failed')
  const blob = await res.blob()
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = 'stock_movements.csv'
  a.click()
  URL.revokeObjectURL(url)
}

export const createAdjustment = (body: object) =>
  request<AdjustmentResult>('/movements/adjustment', { method: 'POST', body: JSON.stringify(body) })

export const receiveStock = (body: object) =>
  request('/movements/receive', { method: 'POST', body: JSON.stringify(body) })

export const receivePending = (body: { product_id: number; location_id: number; quantity: number; notes?: string | null }) =>
  request('/movements/receive-pending', { method: 'POST', body: JSON.stringify(body) })

export const getPendingReceipts = (productId?: number) => {
  const qs = productId ? `?product_id=${productId}` : ''
  return request<PendingReceiptOut[]>(`/movements/pending-receipts${qs}`)
}

export const linkReceiptToInvoiceLine = (movementId: number, invoiceLineId: number) =>
  request(`/movements/${movementId}/link-invoice-line`, {
    method: 'POST',
    body: JSON.stringify({ invoice_line_id: invoiceLineId }),
  })

export const voidMovement = (movement_id: number) =>
  request<VoidMovementResponse>(`/movements/${movement_id}/void`, { method: 'POST' })

// ── Recipes ────────────────────────────────────────────────────────────────

// ── Waste ──────────────────────────────────────────────────────────────────

type WasteParams = {
  date_from?: string
  date_to?: string
  location_id?: number | ''
  category_id?: number | ''
  reason?: string
  limit?: number
  offset?: number
}

export const listWaste = (params: WasteParams = {}) => {
  const qs = new URLSearchParams()
  if (params.date_from)   qs.set('date_from',   params.date_from)
  if (params.date_to)     qs.set('date_to',     params.date_to)
  if (params.location_id) qs.set('location_id', String(params.location_id))
  if (params.category_id) qs.set('category_id', String(params.category_id))
  if (params.reason)      qs.set('reason',      params.reason)
  if (params.limit)       qs.set('limit',       String(params.limit))
  if (params.offset)      qs.set('offset',      String(params.offset))
  return request<WasteListResponse>(`/waste?${qs}`)
}

export const createWaste = (body: {
  product_id: number; location_id: number
  quantity: number; reason?: string | null; notes?: string | null
}) => request('/waste', { method: 'POST', body: JSON.stringify(body) })

export const updateWasteReason = (movement_id: number, reason: string | null, notes: string | null) =>
  request(`/waste/${movement_id}/reason`, {
    method: 'PATCH',
    body: JSON.stringify({ reason, notes }),
  })

export const getWasteAnalytics = (params: { date_from?: string; date_to?: string; location_id?: number | '' } = {}) => {
  const qs = new URLSearchParams()
  if (params.date_from)   qs.set('date_from',   params.date_from)
  if (params.date_to)     qs.set('date_to',     params.date_to)
  if (params.location_id) qs.set('location_id', String(params.location_id))
  return request<WasteAnalytics>(`/waste/analytics?${qs}`)
}

export const exportWaste = async (params: WasteParams = {}) => {
  const qs = new URLSearchParams()
  if (params.date_from)   qs.set('date_from',   params.date_from)
  if (params.date_to)     qs.set('date_to',     params.date_to)
  if (params.location_id) qs.set('location_id', String(params.location_id))
  if (params.category_id) qs.set('category_id', String(params.category_id))
  if (params.reason)      qs.set('reason',      params.reason)
  const res = await fetch(`/api/waste/export?${qs}`)
  if (!res.ok) throw new Error('Export failed')
  const blob = await res.blob()
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = 'waste_log.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// ── Stock Count ────────────────────────────────────────────────────────────

export const listCountSessions = (location_id?: number) => {
  const qs = location_id ? `?location_id=${location_id}` : ''
  return request<CountSessionListResponse>(`/stock-count/sessions${qs}`)
}

export const createCountSession = (body: { location_id: number; notes?: string | null }) =>
  request<CountSessionDetail>('/stock-count/sessions', { method: 'POST', body: JSON.stringify(body) })

export const getCountSession = (id: number) =>
  request<CountSessionDetail>(`/stock-count/sessions/${id}`)

export const updateCountLines = (id: number, lines: Array<{ product_id: number; counted_qty: number | null; notes?: string | null }>) =>
  request(`/stock-count/sessions/${id}/lines`, { method: 'PUT', body: JSON.stringify({ lines }) })

export const updateCountDate = (id: number, count_date: string) =>
  request(`/stock-count/sessions/${id}/date`, { method: 'PATCH', body: JSON.stringify({ count_date }) })

export const submitCountSession = (id: number) =>
  request<CountSessionDetail>(`/stock-count/sessions/${id}/submit`, { method: 'POST' })

export const refreshCountSession = (id: number) =>
  request<CountSessionDetail>(`/stock-count/sessions/${id}/refresh`, { method: 'POST' })

export const approveCountSession = (id: number) =>
  request<PostResult>(`/stock-count/sessions/${id}/approve`, { method: 'POST' })

export const removeCountLine = (sessionId: number, productId: number) =>
  request(`/stock-count/sessions/${sessionId}/lines/${productId}`, { method: 'DELETE' })

export const setCountCategories = (sessionId: number, categoryIds: number[]) =>
  request<CountCategoryNodeOut[]>(`/stock-count/sessions/${sessionId}/categories`, {
    method: 'PUT',
    body: JSON.stringify({ category_ids: categoryIds }),
  })

export const exportCountSession = async (id: number, filename: string) => {
  const res = await fetch(`/api/stock-count/sessions/${id}/export`)
  if (!res.ok) throw new Error('Export failed')
  const blob = await res.blob()
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── Transfers ─────────────────────────────────────────────────────────────

type TransferParams = {
  from_location_id?: number | ''
  to_location_id?: number | ''
  status?: string
  limit?: number
  offset?: number
}

export const listTransfers = (params: TransferParams = {}) => {
  const qs = new URLSearchParams()
  if (params.from_location_id) qs.set('from_location_id', String(params.from_location_id))
  if (params.to_location_id)   qs.set('to_location_id',   String(params.to_location_id))
  if (params.status)           qs.set('status',           params.status)
  if (params.limit)            qs.set('limit',            String(params.limit))
  if (params.offset)           qs.set('offset',           String(params.offset))
  return request<TransferListResponse>(`/transfers?${qs}`)
}

export const createTransfer = (body: {
  from_location_id: number
  to_location_id: number
  notes?: string | null
  lines: Array<{ product_id: number; quantity: number; notes?: string | null }>
}) => request<TransferDetail>('/transfers', { method: 'POST', body: JSON.stringify(body) })

export const getTransfer = (id: number) =>
  request<TransferDetail>(`/transfers/${id}`)

export const confirmTransfer = (id: number) =>
  request<TransferDetail>(`/transfers/${id}/confirm`, { method: 'POST' })

export const cancelTransfer = (id: number) =>
  request<TransferDetail>(`/transfers/${id}/cancel`, { method: 'POST' })

// ── Recipes ────────────────────────────────────────────────────────────────

export const getRecipes    = (include_archived = false) => {
  const qs = new URLSearchParams({ product_type: 'composite' })
  if (include_archived) qs.set('include_archived', 'true')
  return request<RecipeListItem[]>(`/composite-products?${qs}`)
}
export const getRecipe     = (id: number) => request<RecipeDetail>(`/composite-products/${id}`)
export const createRecipe  = (data: object) =>
  request('/composite-products', { method: 'POST', body: JSON.stringify(data) })
export const updateRecipe  = (id: number, data: object) =>
  request(`/composite-products/${id}`, { method: 'PUT', body: JSON.stringify(data) })
export const duplicateRecipe = (id: number) =>
  request<{ id: number }>(`/composite-products/${id}/duplicate`, { method: 'POST' })
export const archiveRecipe = (id: number, is_archived: boolean) =>
  request(`/composite-products/${id}/archive`, { method: 'PATCH', body: JSON.stringify({ is_archived }) })
export const deleteRecipe  = (id: number) =>
  request(`/composite-products/${id}`, { method: 'DELETE' })

// ── Intermediate Products ──────────────────────────────────────────────────

export const getIntermediateProducts = (include_archived = false) => {
  const qs = new URLSearchParams({ product_type: 'intermediate' })
  if (include_archived) qs.set('include_archived', 'true')
  return request<RecipeListItem[]>(`/composite-products?${qs}`)
}
export const getIntermediateProduct = (id: number) =>
  request<RecipeDetail>(`/composite-products/${id}`)
export const createIntermediateProduct = (data: object) =>
  request('/composite-products', { method: 'POST', body: JSON.stringify({ ...data, product_type: 'intermediate' }) })
export const updateIntermediateProduct = (id: number, data: object) =>
  request(`/composite-products/${id}`, { method: 'PUT', body: JSON.stringify({ ...data, product_type: 'intermediate' }) })
export const produceIntermediateBatch = (id: number, data: object) =>
  request<ProductionBatchResult>(`/composite-products/${id}/produce`, { method: 'POST', body: JSON.stringify(data) })
export const getProductionBatches = (id: number) =>
  request<ProductionBatchOut[]>(`/composite-products/${id}/batches`)
