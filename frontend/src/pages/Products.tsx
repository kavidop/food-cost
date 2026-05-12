import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { searchProducts, getProductInvoices, updateProduct, createProduct, getAllProducts, getProduct, mergeProducts, getProductReferenceData, receivePending, getProductDetail, getProductCostHistory, getProductSupplierVariants, updateSupplierVariant, deleteProduct } from '@/api/client'
import { useQuery }    from '@/hooks/useAsync'
import { useMutation } from '@/hooks/useMutation'
import Spinner from '@/components/Spinner'
import type { ProductListItem, ProductPickerItem, ProductInvoiceLine, StockLocation, ProductInventoryDetail, MainCategoryBreakdownItem, ProductCostHistoryItem, SupplierVariantOut } from '@/types/api'

const eur = (n: number) =>
  n.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const qty = (n: number) => {
  if (Number.isInteger(n)) return String(n)
  return n.toLocaleString('el-GR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

const num = (v: number | null | undefined) => (v == null ? '' : String(v))

const formatPack = (p: ProductListItem) => {
  if (!p.units_per_pack || !p.pack_unit) return '—'
  if (p.unit) return `1 ${p.pack_unit} = ${qty(p.units_per_pack)} ${p.unit}`
  return `${qty(p.units_per_pack)}×${p.pack_unit}`
}

const formatPrice = (p: ProductListItem) => {
  if (p.current_price == null) return '—'
  const wholesaleUnit = p.pack_unit ?? p.unit ?? ''
  if (p.units_per_pack && p.units_per_pack > 0 && p.unit) {
    const perRetail = p.current_price / p.units_per_pack
    return `€${eur(p.current_price)}${wholesaleUnit ? `/${wholesaleUnit}` : ''} (€${eur(perRetail)}/${p.unit})`
  }
  return `€${eur(p.current_price)}${wholesaleUnit ? `/${wholesaleUnit}` : ''}`
}

const formatTotalQty = (p: ProductListItem) => {
  const ordered = p.total_quantity_ordered ?? 0
  const wholesaleUnit = p.pack_unit ?? p.unit
  if (p.units_per_pack && p.units_per_pack > 0 && p.pack_unit && p.unit) {
    const retailTotal = ordered * p.units_per_pack
    return `${qty(ordered)} ${p.pack_unit} (${qty(retailTotal)} ${p.unit})`
  }
  if (wholesaleUnit) return `${qty(ordered)} ${wholesaleUnit}`
  return qty(ordered)
}

interface EditState {
  id: number
  name: string
  description: string
  category_id: number | null
  unit_id: number | null
  volume_ml: number | null
  abv_percent: number | null
  units_per_pack: number | null
  pack_unit_id: number | null
  pack_unit_size_ml: number | null
  supplier_id: number | null
  supplier_product_id: number | null
  supplier_sku: string
  current_price: number | null
}

function toEditState(p: ProductListItem): EditState {
  return {
    id:                  p.id,
    name:                p.name,
    description:         p.description ?? '',
    category_id:         p.category_id ?? null,
    unit_id:             p.unit_id ?? null,
    volume_ml:           p.volume_ml ?? null,
    abv_percent:         p.abv_percent ?? null,
    units_per_pack:      p.units_per_pack ?? null,
    pack_unit_id:        p.pack_unit_id ?? null,
    pack_unit_size_ml:   p.pack_unit_size_ml ?? null,
    supplier_id:         null,
    supplier_product_id: p.supplier_product_id ?? null,
    supplier_sku:        (p.supplier_sku && p.supplier_sku !== 'Multi') ? p.supplier_sku : '',
    current_price:       p.current_price ?? null,
  }
}

// ── Reusable primitives ──────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
      <span style={{ fontSize: '.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.03em' }}>
        {label}
      </span>
      {children}
    </label>
  )
}

function ReadValue({ value }: { value: string | number | null | undefined }) {
  return (
    <div style={{
      padding: '.4rem .6rem', background: '#f9fafb', border: '1px solid #e5e7eb',
      borderRadius: 6, fontSize: '.88rem', color: value != null && value !== '' ? '#111827' : '#9ca3af',
      minHeight: 34,
    }}>
      {value != null && value !== '' ? value : '—'}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontWeight: 600, fontSize: '.75rem', textTransform: 'uppercase',
      letterSpacing: '.05em', color: '#9ca3af', marginBottom: '.75rem',
    }}>
      {children}
    </div>
  )
}

// ── View panel content ───────────────────────────────────────────────────────

function ViewDetails({ product, categories, units }: {
  product: ProductListItem
  categories: { id: number; name: string }[]
  units: { id: number; name: string; abbreviation: string }[]
}) {
  const catName  = categories.find(c => c.id === product.category_id)?.name ?? null
  const unitName = units.find(u => u.id === product.unit_id)?.name ?? null
  const packUnit = units.find(u => u.id === product.pack_unit_id)?.name ?? null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <section>
        <SectionTitle>Basic Information</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
          <Field label="Name"><ReadValue value={product.name} /></Field>
          <Field label="Category"><ReadValue value={catName} /></Field>
          <Field label="Description"><ReadValue value={product.description} /></Field>
          <Field label={product.supplier_sku === 'Multi' ? 'Supplier SKUs' : 'Supplier SKU'}>
            {product.supplier_sku === 'Multi' ? (
              <div style={{
                padding: '.4rem .6rem', background: '#eff6ff', border: '1px solid #bfdbfe',
                borderRadius: 6, fontSize: '.82rem', color: '#1d4ed8', minHeight: 34,
                display: 'flex', alignItems: 'center', gap: '.4rem',
              }}>
                <span style={{ fontWeight: 700 }}>Multi</span>
                <span style={{ color: '#6b7280', fontWeight: 400 }}>— see Supplier Aliases below</span>
              </div>
            ) : (
              <div style={{
                padding: '.4rem .6rem', background: '#f9fafb', border: '1px solid #e5e7eb',
                borderRadius: 6, fontSize: '.85rem', fontFamily: 'monospace',
                color: product.supplier_sku ? '#111827' : '#9ca3af', minHeight: 34,
              }}>
                {product.supplier_sku ?? '—'}
              </div>
            )}
          </Field>
        </div>
      </section>

      <section>
        <SectionTitle>Units of Measure</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '.75rem' }}>
          <Field label="Retail Unit"><ReadValue value={unitName} /></Field>
          <Field label="Units per Pack"><ReadValue value={product.units_per_pack} /></Field>
          <Field label="Wholesale Unit"><ReadValue value={packUnit} /></Field>
          <Field label="Pack Size (ml)"><ReadValue value={product.pack_unit_size_ml} /></Field>
        </div>
      </section>

      <section>
        <SectionTitle>Liquid Details</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
          <Field label="Volume (ml)"><ReadValue value={product.volume_ml} /></Field>
          <Field label="ABV %"><ReadValue value={product.abv_percent} /></Field>
        </div>
      </section>

      <section>
        <SectionTitle>Pricing</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
          <Field label="Latest Invoice Price">
            <ReadValue value={formatPrice(product)} />
          </Field>
          <Field label="Total Qty Ordered (all suppliers)">
            <ReadValue value={formatTotalQty(product)} />
          </Field>
        </div>
      </section>
    </div>
  )
}

// ── Edit form content ────────────────────────────────────────────────────────

function EditDetails({ editing, set, categories, units, suppliers, isNew }: {
  editing: EditState
  set: (patch: Partial<EditState>) => void
  categories: { id: number; name: string }[]
  units: { id: number; name: string; abbreviation: string }[]
  suppliers: { id: number; name: string }[]
  isNew?: boolean
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <section>
        <SectionTitle>Basic Information</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
          <Field label="Name">
            <input value={editing.name} onChange={e => set({ name: e.target.value })} />
          </Field>
          <Field label="Category">
            <select
              value={editing.category_id ?? ''}
              onChange={e => set({ category_id: e.target.value ? +e.target.value : null })}
            >
              <option value="">— none —</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Description">
            <input value={editing.description} onChange={e => set({ description: e.target.value })} />
          </Field>
          <Field label="Supplier SKU">
            <input
              value={editing.supplier_sku}
              onChange={e => set({ supplier_sku: e.target.value })}
              style={{ fontFamily: 'monospace' }}
            />
          </Field>
        </div>
        {isNew && (
          <div style={{ marginTop: '.75rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
            <Field label="Preferred Supplier">
              <select
                value={editing.supplier_id ?? ''}
                onChange={e => set({ supplier_id: e.target.value ? +e.target.value : null })}
              >
                <option value="">— none —</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Price">
              <input
                type="number" min="0" step="0.01" placeholder="e.g. 12.50"
                value={num(editing.current_price)}
                onChange={e => set({ current_price: e.target.value ? +e.target.value : null })}
              />
            </Field>
          </div>
        )}
      </section>

      <section>
        <SectionTitle>Units of Measure</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '.75rem' }}>
          <Field label="Retail Unit">
            <select
              value={editing.unit_id ?? ''}
              onChange={e => set({ unit_id: e.target.value ? +e.target.value : null })}
            >
              <option value="">— none —</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.name} ({u.abbreviation})</option>)}
            </select>
          </Field>
          <Field label="Units per Pack">
            <input
              type="number" min="1" step="1" placeholder="e.g. 6"
              value={num(editing.units_per_pack)}
              onChange={e => set({ units_per_pack: e.target.value ? +e.target.value : null })}
            />
          </Field>
          <Field label="Wholesale Unit">
            <select
              value={editing.pack_unit_id ?? ''}
              onChange={e => set({ pack_unit_id: e.target.value ? +e.target.value : null })}
            >
              <option value="">— none —</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.name} ({u.abbreviation})</option>)}
            </select>
          </Field>
          <Field label="Pack Size (ml)">
            <input
              type="number" min="0" step="1" placeholder="e.g. 700"
              value={num(editing.pack_unit_size_ml)}
              onChange={e => set({ pack_unit_size_ml: e.target.value ? +e.target.value : null })}
            />
          </Field>
        </div>
        <div style={{ marginTop: '.5rem', fontSize: '.8rem', color: '#6b7280' }}>
          Example: a case (wholesale unit) of 6 bottles (retail unit) × 700 ml each
        </div>
      </section>

      <section>
        <SectionTitle>Liquid Details (optional)</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
          <Field label="Volume (ml)">
            <input
              type="number" min="0" step="1" placeholder="e.g. 700"
              value={num(editing.volume_ml)}
              onChange={e => set({ volume_ml: e.target.value ? +e.target.value : null })}
            />
          </Field>
          <Field label="ABV %">
            <input
              type="number" min="0" max="100" step="0.1" placeholder="e.g. 40.0"
              value={num(editing.abv_percent)}
              onChange={e => set({ abv_percent: e.target.value ? +e.target.value : null })}
            />
          </Field>
        </div>
      </section>
    </div>
  )
}

// ── Supplier Aliases section ─────────────────────────────────────────────────

function SupplierAliasesSection({
  variants, editingSpId, variantEdits, variantError, variantSaving,
  onStartEdit, onCancelEdit, onChangeEdits, onSave, onSetPreferred,
}: {
  variants: SupplierVariantOut[]
  editingSpId: number | null
  variantEdits: { sku: string; name: string }
  variantError: string | null
  variantSaving: boolean
  onStartEdit: (v: SupplierVariantOut) => void
  onCancelEdit: () => void
  onChangeEdits: (e: { sku: string; name: string }) => void
  onSave: (spId: number) => void
  onSetPreferred: (spId: number) => void
}) {
  if (variants.length === 0) return null
  const th: React.CSSProperties = {
    padding: '.35rem .6rem', background: '#f9fafb', border: '1px solid #e5e7eb',
    textAlign: 'left', fontWeight: 600, fontSize: '.72rem', color: '#6b7280',
    textTransform: 'uppercase', letterSpacing: '.03em',
  }
  const td: React.CSSProperties = {
    padding: '.4rem .6rem', border: '1px solid #f3f4f6', fontSize: '.85rem',
  }
  return (
    <section>
      <SectionTitle>Supplier Aliases ({variants.length})</SectionTitle>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['Supplier', 'Alias Name', 'SKU', 'Price', 'Preferred', ''].map(h => (
              <th key={h} style={th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {variants.map(v => {
            const isEditing = editingSpId === v.supplier_product_id
            return (
              <tr key={v.supplier_product_id}>
                <td style={{ ...td, fontWeight: 500 }}>{v.supplier_name}</td>
                <td style={td}>
                  {isEditing
                    ? <input value={variantEdits.name}
                        onChange={e => onChangeEdits({ ...variantEdits, name: e.target.value })}
                        placeholder="Supplier's name for this product"
                        style={{ width: '100%', padding: '.3rem .45rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.85rem' }} />
                    : <span style={{ color: v.supplier_product_name ? '#111827' : '#9ca3af' }}>
                        {v.supplier_product_name ?? '—'}
                      </span>}
                </td>
                <td style={td}>
                  {isEditing
                    ? <input value={variantEdits.sku}
                        onChange={e => onChangeEdits({ ...variantEdits, sku: e.target.value })}
                        placeholder="SKU"
                        style={{ width: 120, padding: '.3rem .45rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.85rem', fontFamily: 'monospace' }} />
                    : <span style={{ fontFamily: 'monospace', color: v.supplier_sku ? '#111827' : '#9ca3af' }}>
                        {v.supplier_sku ?? '—'}
                      </span>}
                </td>
                <td style={{ ...td, textAlign: 'right' }}>
                  {v.current_price != null ? `€${v.current_price.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                </td>
                <td style={{ ...td, textAlign: 'center' }}>
                  {v.is_preferred_supplier
                    ? <span style={{ color: '#059669', fontWeight: 700, fontSize: '1rem' }} title="Preferred supplier">★</span>
                    : <button
                        onClick={() => onSetPreferred(v.supplier_product_id)}
                        style={{ fontSize: '.75rem', padding: '2px 7px', cursor: 'pointer', background: '#f9fafb', border: '1px solid #d1d5db', borderRadius: 4 }}>
                        Set
                      </button>}
                </td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  {isEditing ? (
                    <>
                      <button
                        onClick={() => onSave(v.supplier_product_id)}
                        disabled={variantSaving}
                        style={{ fontSize: '.78rem', padding: '3px 8px', marginRight: 4, background: '#111827', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                        {variantSaving ? '…' : 'Save'}
                      </button>
                      <button
                        onClick={onCancelEdit}
                        style={{ fontSize: '.78rem', padding: '3px 8px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => onStartEdit(v)}
                      style={{ fontSize: '.78rem', padding: '3px 8px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}>
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {variantError && <p style={{ color: '#dc2626', fontSize: '.8rem', marginTop: '.4rem' }}>{variantError}</p>}
    </section>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Products() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [query,      setQuery]      = useState('')
  const [catId,      setCatId]      = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [page,       setPage]       = useState(1)
  const [sortBy,     setSortBy]     = useState('name')
  const [sortDir,    setSortDir]    = useState('asc')

  // Modal state
  const [selected,    setSelected]    = useState<ProductListItem | null>(null)
  const [editState,   setEditState]   = useState<EditState | null>(null)
  const [history,     setHistory]     = useState<ProductInvoiceLine[] | null>(null)
  const [inventory,   setInventory]   = useState<ProductInventoryDetail | null>(null)
  const [invLoading,  setInvLoading]  = useState(false)
  const [costHistory, setCostHistory] = useState<ProductCostHistoryItem[] | null>(null)
  const [costLoading, setCostLoading] = useState(false)
  const [activeTab,   setActiveTab]   = useState<'details' | 'history' | 'inventory' | 'cost'>('details')

  // Supplier aliases state
  const [variants,      setVariants]      = useState<SupplierVariantOut[] | null>(null)
  const [editingSpId,   setEditingSpId]   = useState<number | null>(null)
  const [variantEdits,  setVariantEdits]  = useState<{ sku: string; name: string }>({ sku: '', name: '' })
  const [variantSaving, setVariantSaving] = useState(false)
  const [variantError,  setVariantError]  = useState<string | null>(null)

  const [confirmDelete, setConfirmDelete] = useState(false)

  // Merge modal state
  const [mergeOpen,    setMergeOpen]    = useState(false)
  const [mergeSearch,  setMergeSearch]  = useState('')
  const [mergeTarget,  setMergeTarget]  = useState<ProductPickerItem | null>(null)
  const { data: allProducts, reload: reloadAllProducts } = useQuery(getAllProducts)

  // "New product" slide-over state
  const [showCreate,  setShowCreate]  = useState(false)
  const [newProduct,  setNewProduct]  = useState<EditState>({
    id: 0, name: '', description: '', category_id: null, unit_id: null,
    volume_ml: null, abv_percent: null, units_per_pack: null,
    pack_unit_id: null, pack_unit_size_ml: null, supplier_id: null, supplier_product_id: null, supplier_sku: '', current_price: null,
  })
  const [createError, setCreateError] = useState<string | null>(null)

  // "Receive without invoice" modal state
  const [receiveProduct, setReceiveProduct] = useState<ProductListItem | null>(null)
  const [receiveLocId,   setReceiveLocId]   = useState<number | ''>('')
  const [receiveQty,     setReceiveQty]     = useState('')
  const [receiveNotes,   setReceiveNotes]   = useState('')
  const [receiveError,   setReceiveError]   = useState<string | null>(null)

  const { data: refData, reload: reloadRefData } = useQuery(getProductReferenceData)
  const categories = refData?.categories ?? []
  const units      = refData?.units ?? []
  const suppliers  = refData?.suppliers ?? []
  const stats      = refData?.stats ?? null
  const locations  = refData?.locations ?? []
  const breakdown  = refData?.breakdown ?? [] as MainCategoryBreakdownItem[]

  const doReceivePending = useMutation(async () => {
    if (!receiveProduct) return
    if (!receiveLocId) throw new Error('Select a location')
    const q = parseFloat(receiveQty)
    if (!receiveQty || isNaN(q) || q <= 0) throw new Error('Enter a valid quantity')
    const upp = receiveProduct.units_per_pack
    const retailQty = (upp && upp > 1) ? q * upp : q
    await receivePending({
      product_id:  receiveProduct.id,
      location_id: receiveLocId as number,
      quantity:    retailQty,
      notes:       receiveNotes || null,
    })
    setReceiveProduct(null)
    setReceiveLocId('')
    setReceiveQty('')
    setReceiveNotes('')
    reloadRefData()
  })

  const openReceive = (p: ProductListItem) => {
    setReceiveProduct(p)
    setReceiveLocId('')
    setReceiveQty('')
    setReceiveNotes('')
    setReceiveError(null)
    doReceivePending.reset()
  }

  const handleReceive = async () => {
    setReceiveError(null)
    try { await doReceivePending.mutate(undefined as void) }
    catch (e: unknown) { setReceiveError(e instanceof Error ? e.message : 'Failed') }
  }

  const doCreate = useMutation(async () => {
    if (!newProduct.name.trim()) throw new Error('Name is required')
    await createProduct({
      name:              newProduct.name.trim(),
      description:       newProduct.description || null,
      category_id:       newProduct.category_id,
      unit_id:           newProduct.unit_id,
      volume_ml:         newProduct.volume_ml,
      abv_percent:       newProduct.abv_percent,
      units_per_pack:    newProduct.units_per_pack,
      pack_unit_id:      newProduct.pack_unit_id,
      pack_unit_size_ml: newProduct.pack_unit_size_ml,
      supplier_id:       newProduct.supplier_id || null,
      supplier_sku:      newProduct.supplier_sku || null,
      current_price:     newProduct.current_price || null,
    })
    setShowCreate(false)
    setNewProduct({
      id: 0, name: '', description: '', category_id: null, unit_id: null,
      volume_ml: null, abv_percent: null, units_per_pack: null,
      pack_unit_id: null, pack_unit_size_ml: null, supplier_id: null, supplier_product_id: null, supplier_sku: '', current_price: null,
    })
    await reload()
    reloadRefData()
  })

  const handleCreate = async () => {
    setCreateError(null)
    try { await doCreate.mutate(undefined as void) }
    catch (e: unknown) { setCreateError(e instanceof Error ? e.message : 'Failed to create') }
  }

  const { data, loading, error, reload } = useQuery(
    () => searchProducts({ q: query, category_id: catId, supplier_id: supplierId, page, sort_by: sortBy, sort_dir: sortDir }),
    [query, catId, supplierId, page, sortBy, sortDir],
  )

  const openView = useMutation(async (p: ProductListItem) => {
    setSelected(p)
    setEditState(null)
    setHistory(null)
    setInventory(null)
    setCostHistory(null)
    setVariants(null)
    setEditingSpId(null)
    setActiveTab('details')
    const [hist, vars, detail] = await Promise.all([
      getProductInvoices(p.id),
      getProductSupplierVariants(p.id),
      getProduct(p.id),
    ])
    setHistory(hist)
    setVariants(vars)
    if (detail) setSelected(detail)
  })

  const switchTab = async (t: 'details' | 'history' | 'inventory' | 'cost') => {
    setActiveTab(t)
    if (t === 'inventory' && inventory === null && selected) {
      setInvLoading(true)
      try { setInventory(await getProductDetail(selected.id)) }
      finally { setInvLoading(false) }
    }
    if (t === 'cost' && costHistory === null && selected) {
      setCostLoading(true)
      try { setCostHistory(await getProductCostHistory(selected.id)) }
      finally { setCostLoading(false) }
    }
  }

  // Auto-open product detail when ?open=<id> is in the URL
  useEffect(() => {
    const pid = searchParams.get('open')
    if (pid && !selected) {
      getProduct(+pid).then(product => {
        if (product) openView.mutate(product)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const saveMutation = useMutation(async () => {
    if (!editState) return
    await updateProduct(editState.id, {
      name:              editState.name,
      description:       editState.description || null,
      category_id:       editState.category_id,
      unit_id:           editState.unit_id,
      volume_ml:         editState.volume_ml,
      abv_percent:       editState.abv_percent,
      units_per_pack:    editState.units_per_pack,
      pack_unit_id:      editState.pack_unit_id,
      pack_unit_size_ml: editState.pack_unit_size_ml,
      supplier_product_id: editState.supplier_product_id,
      supplier_sku:      editState.supplier_sku || null,
    })
    const [,, detail] = await Promise.all([reload(), reloadAllProducts(), getProduct(editState.id)])
    setEditState(null)
    if (detail) setSelected(detail)
  })

  const set = (patch: Partial<EditState>) =>
    setEditState(prev => prev ? { ...prev, ...patch } : prev)

  const mergeMutation = useMutation(async () => {
    if (!selected || !mergeTarget) return
    await mergeProducts(selected.id, mergeTarget.id)
    setMergeOpen(false)
    setMergeTarget(null)
    setMergeSearch('')
    setSelected(null)
    setEditState(null)
    await reload()
  })

  const openMerge = () => { setMergeOpen(true); setMergeSearch(''); setMergeTarget(null) }
  const closeMerge = () => { setMergeOpen(false); setMergeTarget(null); mergeMutation.reset() }

  const deleteMutation = useMutation(async () => {
    if (!selected) return
    await deleteProduct(selected.id)
    setSelected(null)
    setEditState(null)
    setVariants(null)
    setEditingSpId(null)
    setConfirmDelete(false)
    closeMerge()
    await reload()
    await reloadAllProducts()
  })

  const closeModal = () => {
    setSelected(null)
    setEditState(null)
    setVariants(null)
    setEditingSpId(null)
    setConfirmDelete(false)
    closeMerge()
    setSearchParams({})
  }

  const startEditVariant = (v: SupplierVariantOut) => {
    setEditingSpId(v.supplier_product_id)
    setVariantEdits({ sku: v.supplier_sku ?? '', name: v.supplier_product_name ?? '' })
    setVariantError(null)
  }
  const cancelEditVariant = () => { setEditingSpId(null); setVariantError(null) }
  const saveVariant = async (spId: number) => {
    if (!selected) return
    setVariantSaving(true)
    setVariantError(null)
    try {
      await updateSupplierVariant(selected.id, spId, {
        supplier_sku: variantEdits.sku || null,
        supplier_product_name: variantEdits.name || null,
      })
      setVariants(await getProductSupplierVariants(selected.id))
      setEditingSpId(null)
    } catch (e) {
      setVariantError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setVariantSaving(false)
    }
  }
  const setPreferredVariant = async (spId: number) => {
    if (!selected) return
    try {
      await updateSupplierVariant(selected.id, spId, { is_preferred_supplier: 1 })
      const [vars, updated] = await Promise.all([
        getProductSupplierVariants(selected.id),
        getProduct(selected.id),
      ])
      setVariants(vars)
      if (updated) setSelected(updated)
    } catch { /* non-critical */ }
  }

  const enterEdit = () => {
    if (selected) {
      setEditState(toEditState(selected))
      reloadRefData()
    }
  }

  const cancelEdit = () => setEditState(null)

  const toggleSort = (col: string) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('asc') }
    setPage(1)
  }

  if (error) return <p style={{ color: 'red' }}>{error}</p>

  const products = data?.products ?? []
  const total    = data?.total    ?? 0
  const perPage  = data?.per_page ?? 25
  const pages    = Math.ceil(total / perPage)
  const cats     = categories ?? []
  const unitList = units ?? []

  const isEditing = editState !== null

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.25rem' }}>
        <h1 style={{ margin: 0 }}>
          Products ({total})
          {loading && data && (
            <span style={{ marginLeft: '.6rem', fontSize: '.75rem', color: '#9ca3af', fontWeight: 400 }}>updating…</span>
          )}
        </h1>
        <button
          onClick={() => setShowCreate(true)}
          style={{
            padding: '.45rem 1rem', background: '#111827', color: 'white',
            border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '.85rem', fontWeight: 600,
          }}
        >
          + New Product
        </button>
      </div>
      <div style={{ marginBottom: '1rem' }} />

      {/* Stats bar */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: '.75rem', marginBottom: '.75rem' }}>
          {[
            { label: 'Total Products',    value: stats.total_active,         color: '#111827' },
            { label: 'Missing Cost',      value: stats.missing_cost,          color: stats.missing_cost > 0      ? '#b45309' : '#111827' },
            { label: 'Low Stock',         value: stats.low_stock,             color: stats.low_stock > 0         ? '#b45309' : '#111827' },
            { label: 'Out of Stock',      value: stats.out_of_stock,          color: stats.out_of_stock > 0      ? '#dc2626' : '#111827' },
            { label: 'Stock Value',       value: `€${eur(stats.stock_value)}`,color: '#059669' },
            { label: 'Pending Receipts',  value: stats.pending_receipts,      color: stats.pending_receipts > 0  ? '#7c3aed' : '#111827' },
          ].map(s => (
            <div key={s.label} className="card" style={{ padding: '.75rem 1rem', textAlign: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: '1.15rem', color: s.color as string }}>{s.value}</div>
              <div style={{ fontSize: '.72rem', color: '#6b7280', marginTop: '.2rem', textTransform: 'uppercase', letterSpacing: '.04em' }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Category breakdown */}
      {breakdown.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${breakdown.length}, 1fr)`, gap: '.75rem', marginBottom: '1.25rem' }}>
          {breakdown.map(cat => (
            <div key={cat.id} className="card" style={{ padding: '.65rem 1rem', display: 'flex', gap: '1.25rem', alignItems: 'center' }}>
              <div style={{ fontSize: '.78rem', fontWeight: 700, color: '#4f46e5', textTransform: 'uppercase', letterSpacing: '.04em', minWidth: 72 }}>
                {cat.name}
              </div>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                {[
                  { l: 'Products', v: String(cat.product_count), c: '#111827' },
                  { l: 'Stock Value', v: `€${eur(cat.stock_value)}`, c: '#059669' },
                  { l: 'Spend', v: `€${eur(cat.total_spend)}`, c: '#111827' },
                  { l: 'Out of Stock', v: String(cat.out_of_stock), c: cat.out_of_stock > 0 ? '#dc2626' : '#9ca3af' },
                  { l: 'Low Stock', v: String(cat.low_stock), c: cat.low_stock > 0 ? '#d97706' : '#9ca3af' },
                ].map(item => (
                  <div key={item.l} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '.82rem', fontWeight: 700, color: item.c }}>{item.v}</div>
                    <div style={{ fontSize: '.65rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.03em' }}>{item.l}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '.75rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <input
          placeholder="Search by name, description, SKU…"
          value={query}
          onChange={e => { setQuery(e.target.value); setPage(1) }}
          style={{ maxWidth: 300 }}
        />
        <select
          value={catId}
          onChange={e => { setCatId(e.target.value); setPage(1) }}
          style={{ maxWidth: 200 }}
        >
          <option value="">All categories</option>
          {cats.map(c => (
            <option key={c.id} value={String(c.id)}>{c.name}</option>
          ))}
        </select>
        <select
          value={supplierId}
          onChange={e => { setSupplierId(e.target.value); setPage(1) }}
          style={{ maxWidth: 200 }}
        >
          <option value="">All suppliers</option>
          {(suppliers ?? []).map(s => (
            <option key={s.id} value={String(s.id)}>{s.trade_name || s.name}</option>
          ))}
        </select>
        {(query || catId || supplierId) && (
          <button
            className="btn-secondary"
            style={{ fontSize: '.8rem', padding: '4px 10px' }}
            onClick={() => { setQuery(''); setCatId(''); setSupplierId(''); setPage(1) }}
          >
            ✕ Clear
          </button>
        )}
      </div>

      {/* Table */}
      <table>
        <thead>
          <tr>
            {[
              { label: 'Name',     col: 'name'     },
              { label: 'Category', col: 'category' },
              { label: 'SKU',      col: 'sku'      },
              { label: 'Unit',     col: ''         },
              { label: 'Pack',     col: ''         },
              { label: 'Price (Wholesale / Retail)',    col: 'price'    },
              { label: 'Total Purchased (Wholesale / Retail)',col: ''         },
              { label: '',         col: ''         },
            ].map(h => (
              <th
                key={h.label}
                style={{ cursor: h.col ? 'pointer' : 'default', whiteSpace: 'nowrap' }}
                onClick={() => h.col && toggleSort(h.col)}
              >
                {h.label}{h.col === sortBy ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && !data && (
            <tr>
              <td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: '#9ca3af' }}>
                <Spinner />
              </td>
            </tr>
          )}
          {products.map(p => (
            <tr key={p.id}>
              <td style={{ fontWeight: 500 }}>
                <button
                  onClick={() => openView.mutate(p)}
                  style={{
                    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    color: '#1d4ed8', fontWeight: 600, fontSize: 'inherit', textAlign: 'left',
                  }}
                >
                  {p.name}
                </button>
              </td>
              <td style={{ color: '#6b7280', fontSize: '.85rem' }}>{p.category ?? '—'}</td>
              <td style={{ fontSize: '.8rem' }}>
                {p.supplier_sku === 'Multi'
                  ? <span style={{ background: '#eff6ff', color: '#1d4ed8', padding: '1px 7px', borderRadius: 9999, fontSize: '.75rem', fontWeight: 700 }}>Multi</span>
                  : <span style={{ fontFamily: 'monospace', color: '#6b7280' }}>{p.supplier_sku ?? '—'}</span>}
              </td>
              <td style={{ fontSize: '.85rem' }}>{p.unit ?? '—'}</td>
              <td style={{ fontSize: '.85rem' }}>
                {formatPack(p)}
              </td>
              <td>{formatPrice(p)}</td>
              <td>{formatTotalQty(p)}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn-secondary" onClick={() => openView.mutate(p)} style={{ marginRight: '.35rem' }}>View</button>
                <button
                  onClick={() => openReceive(p)}
                  style={{
                    padding: '.25rem .6rem', fontSize: '.75rem', cursor: 'pointer',
                    background: '#f5f3ff', border: '1px solid #c4b5fd', borderRadius: 4,
                    color: '#6d28d9', fontWeight: 600,
                  }}
                  title="Receive stock without an invoice"
                >
                  No Invoice
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Pagination */}
      {pages > 1 && (
        <div style={{ display: 'flex', gap: '.5rem', marginTop: '1rem', alignItems: 'center' }}>
          <button className="btn-secondary" disabled={page <= 1}    onClick={() => setPage(p => p - 1)}>‹ Prev</button>
          <span style={{ fontSize: '.85rem' }}>Page {page} of {pages}</span>
          <button className="btn-secondary" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next ›</button>
        </div>
      )}

      {/* ── New Product slide-over ───────────────────────────────────────── */}
      {showCreate && (
        <>
          <div
            onClick={() => setShowCreate(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.3)', zIndex: 50 }}
          />
          <div style={{
            position: 'fixed', top: 0, right: 0, width: 480, height: '100vh',
            background: 'white', zIndex: 60, boxShadow: '-4px 0 24px rgba(0,0,0,.12)',
            display: 'flex', flexDirection: 'column', overflowY: 'auto',
          }}>
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>New Product</h2>
              <button onClick={() => setShowCreate(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: '#6b7280' }}>×</button>
            </div>

            <div style={{ padding: '1.25rem 1.5rem', flex: 1 }}>
              <EditDetails editing={newProduct} set={p => setNewProduct(prev => ({ ...prev, ...p }))} categories={cats} units={unitList} suppliers={suppliers} isNew />
            </div>

            <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
              {createError && <p style={{ color: '#dc2626', fontSize: '.82rem', margin: 0 }}>{createError}</p>}
              <div style={{ display: 'flex', gap: '.75rem', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setShowCreate(false)}
                  style={{ padding: '.4rem .9rem', background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: '.85rem' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={doCreate.loading || !newProduct.name.trim()}
                  style={{
                    padding: '.4rem 1.1rem', background: '#111827', color: '#fff',
                    border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: '.85rem',
                  }}
                >
                  {doCreate.loading ? 'Creating…' : 'Create Product'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Receive Without Invoice modal ────────────────────────────────── */}
      {receiveProduct && (
        <>
          <div
            onClick={() => setReceiveProduct(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 60 }}
          />
          <div style={{
            position: 'fixed', top: '50%', left: '50%',
            transform: 'translate(-50%,-50%)',
            background: '#fff', borderRadius: '.75rem', zIndex: 70,
            width: '90%', maxWidth: 440,
            boxShadow: '0 24px 64px rgba(0,0,0,.28)',
            padding: '1.5rem',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.1rem' }}>
              <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Receive Without Invoice</h2>
              <button onClick={() => setReceiveProduct(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: '#6b7280' }}>×</button>
            </div>

            <div style={{ marginBottom: '1rem', padding: '.6rem .75rem', background: '#f5f3ff', border: '1px solid #c4b5fd', borderRadius: 6 }}>
              <div style={{ fontWeight: 600, fontSize: '.9rem', color: '#4c1d95' }}>{receiveProduct.name}</div>
              {receiveProduct.pack_unit && (
                <div style={{ fontSize: '.78rem', color: '#6b7280', marginTop: '.15rem' }}>
                  Wholesale unit: {receiveProduct.pack_unit}{receiveProduct.units_per_pack && receiveProduct.units_per_pack > 1 ? ` (${qty(receiveProduct.units_per_pack)} ${receiveProduct.unit ?? 'pcs'} each)` : ''}
                </div>
              )}
              {!receiveProduct.pack_unit && receiveProduct.unit && (
                <div style={{ fontSize: '.78rem', color: '#6b7280', marginTop: '.15rem' }}>Unit: {receiveProduct.unit}</div>
              )}
            </div>

            <label style={{ display: 'block', fontSize: '.82rem', fontWeight: 600, color: '#374151', marginBottom: '.3rem' }}>Location *</label>
            <select
              value={receiveLocId}
              onChange={e => setReceiveLocId(e.target.value === '' ? '' : Number(e.target.value))}
              style={{ width: '100%', padding: '.4rem .55rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '.85rem', marginBottom: '.85rem' }}
            >
              <option value="">Select location…</option>
              {(locations ?? []).map((l: StockLocation) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>

            <label style={{ display: 'block', fontSize: '.82rem', fontWeight: 600, color: '#374151', marginBottom: '.3rem' }}>
              Quantity *{receiveProduct.pack_unit ? ` (in ${receiveProduct.pack_unit})` : ''}
            </label>
            <input
              type="number" min="0.001" step="any" placeholder="e.g. 5"
              value={receiveQty}
              onChange={e => setReceiveQty(e.target.value)}
              style={{ width: '100%', padding: '.4rem .55rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '.85rem', marginBottom: '.85rem', boxSizing: 'border-box' }}
            />

            <label style={{ display: 'block', fontSize: '.82rem', fontWeight: 600, color: '#374151', marginBottom: '.3rem' }}>Notes</label>
            <textarea
              rows={2}
              placeholder="Optional — invoice to follow, delivery note ref, etc."
              value={receiveNotes}
              onChange={e => setReceiveNotes(e.target.value)}
              style={{ width: '100%', padding: '.4rem .55rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '.85rem', resize: 'vertical', boxSizing: 'border-box', marginBottom: '.85rem' }}
            />

            <p style={{ fontSize: '.78rem', color: '#6b7280', margin: '0 0 .85rem' }}>
              Stock will be added immediately and marked as <em>pending invoice</em>. You can link it to an invoice line later.
            </p>

            {receiveError && <p style={{ color: '#dc2626', fontSize: '.82rem', marginBottom: '.6rem' }}>{receiveError}</p>}

            <div style={{ display: 'flex', gap: '.6rem', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setReceiveProduct(null)}
                style={{ padding: '.4rem .9rem', background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: '.85rem' }}
              >
                Cancel
              </button>
              <button
                onClick={handleReceive}
                disabled={doReceivePending.loading || !receiveLocId || !receiveQty}
                style={{
                  padding: '.4rem 1rem', background: '#6d28d9', color: '#fff',
                  border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: '.85rem',
                }}
              >
                {doReceivePending.loading ? 'Receiving…' : 'Receive Stock'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Merge picker sub-modal ────────────────────────────────────────── */}
      {selected && mergeOpen && (() => {
        const q = mergeSearch.toLowerCase()
        const candidates = (allProducts ?? []).filter(p =>
          p.id !== selected.id && (!q || p.name.toLowerCase().includes(q))
        )
        return (
          <>
            <div onClick={closeMerge} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.2)', zIndex: 60 }} />
            <div style={{
              position: 'fixed', top: '8%', left: '50%', transform: 'translateX(-50%)',
              background: '#fff', borderRadius: '.75rem', zIndex: 70,
              width: '90%', maxWidth: 520, maxHeight: '80vh',
              display: 'flex', flexDirection: 'column',
              boxShadow: '0 24px 64px rgba(0,0,0,.32)',
            }}>
              <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 700, fontSize: '.95rem' }}>
                  Merge "{selected.name}" into…
                </div>
                <button className="btn-secondary" onClick={closeMerge}>✕</button>
              </div>

              {mergeTarget ? (
                <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: 8, padding: '1rem', fontSize: '.88rem', lineHeight: 1.5 }}>
                    <strong>"{selected.name}"</strong> will be merged into <strong>"{mergeTarget.name}"</strong>.<br />
                    All stock, invoice history, and supplier data will move to the target.
                    Prices will be averaged. <strong>"{selected.name}" will be permanently deleted.</strong>
                  </div>
                  {mergeMutation.error && (
                    <div style={{ color: '#b91c1c', fontSize: '.85rem' }}>{mergeMutation.error}</div>
                  )}
                  <div style={{ display: 'flex', gap: '.75rem', justifyContent: 'flex-end' }}>
                    <button className="btn-secondary" onClick={() => setMergeTarget(null)} disabled={mergeMutation.loading}>
                      Back
                    </button>
                    <button
                      style={{ padding: '.4rem 1rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: '.85rem' }}
                      disabled={mergeMutation.loading}
                      onClick={() => mergeMutation.mutate(undefined as void)}
                    >
                      {mergeMutation.loading ? 'Merging…' : 'Confirm Merge'}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ padding: '.75rem 1.25rem', borderBottom: '1px solid #e5e7eb' }}>
                    <input
                      autoFocus
                      placeholder="Search products…"
                      value={mergeSearch}
                      onChange={e => setMergeSearch(e.target.value)}
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div style={{ overflowY: 'auto', flex: 1 }}>
                    {candidates.length === 0 ? (
                      <div style={{ padding: '1.5rem', color: '#6b7280', fontSize: '.88rem', textAlign: 'center' }}>
                        No products found
                      </div>
                    ) : candidates.map(p => (
                      <button
                        key={p.id}
                        onClick={() => setMergeTarget(p)}
                        style={{
                          display: 'block', width: '100%', padding: '.65rem 1.25rem', background: 'none',
                          border: 'none', borderBottom: '1px solid #f3f4f6', cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        <div style={{ fontWeight: 500, fontSize: '.88rem' }}>{p.name}</div>
                        <div style={{ color: '#6b7280', fontSize: '.78rem', marginTop: 2 }}>
                          {p.supplier && <span>{p.supplier}</span>}
                          {p.supplier_sku && <span style={{ fontFamily: 'monospace', marginLeft: p.supplier ? 4 : 0 }}>{p.supplier ? '· ' : ''}{p.supplier_sku}</span>}
                          {p.current_price ? <span style={{ marginLeft: (p.supplier || p.supplier_sku) ? 4 : 0 }}>{(p.supplier || p.supplier_sku) ? '· ' : ''}€{p.current_price.toFixed(2)}{p.unit ? `/${p.unit}` : ''}</span> : null}
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </>
        )
      })()}

      {/* ── View / Edit modal ─────────────────────────────────────────────── */}
      {selected && (
        <>
          <div
            onClick={closeModal}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 40 }}
          />
          <div style={{
            position: 'fixed', top: '3%', left: '50%', transform: 'translateX(-50%)',
            background: '#fff', borderRadius: '.75rem', zIndex: 50,
            width: '90%', maxWidth: 760, maxHeight: '92vh',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 24px 64px rgba(0,0,0,.28)',
          }}>

            {/* Header */}
            <div style={{
              padding: '1.1rem 1.5rem', borderBottom: '1px solid #e5e7eb',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', minWidth: 0 }}>
                <div style={{
                  fontWeight: 700, fontSize: '1.05rem',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {selected.name}
                </div>
                {isEditing && (
                  <span style={{
                    fontSize: '.72rem', fontWeight: 600, padding: '.15rem .5rem',
                    borderRadius: 9999, background: '#fef3c7', color: '#92400e',
                    whiteSpace: 'nowrap',
                  }}>
                    Editing
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexShrink: 0 }}>
                {!isEditing && (
                  <>
                    <button
                      onClick={openMerge}
                      style={{
                        padding: '.35rem .85rem', background: '#fff', color: '#374151',
                        border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer',
                        fontSize: '.82rem', fontWeight: 600,
                      }}
                    >
                      Merge into…
                    </button>
                    <button
                      onClick={enterEdit}
                      style={{
                        padding: '.35rem .85rem', background: '#111827', color: 'white',
                        border: 'none', borderRadius: 6, cursor: 'pointer',
                        fontSize: '.82rem', fontWeight: 600,
                      }}
                    >
                      Edit
                    </button>
                  </>
                )}
                <button className="btn-secondary" onClick={closeModal}>✕</button>
              </div>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb' }}>
              {([
                { key: 'details',   label: 'Product Details' },
                { key: 'history',   label: `Invoice History${history ? ` (${history.length})` : ''}` },
                { key: 'inventory', label: 'Inventory' },
                { key: 'cost',      label: `Cost History${costHistory ? ` (${costHistory.length})` : ''}` },
              ] as { key: 'details' | 'history' | 'inventory' | 'cost'; label: string }[]).map(t => (
                <button
                  key={t.key}
                  onClick={() => switchTab(t.key)}
                  style={{
                    border: 'none', background: 'none', padding: '.75rem 1.5rem',
                    fontWeight: activeTab === t.key ? 600 : 400,
                    color: activeTab === t.key ? '#4f46e5' : '#6b7280',
                    borderBottom: activeTab === t.key ? '2px solid #4f46e5' : '2px solid transparent',
                    cursor: 'pointer', fontSize: '.9rem', whiteSpace: 'nowrap',
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Body */}
            <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto', flex: 1 }}>
              {activeTab === 'details' && (
                <>
                  {isEditing
                    ? <EditDetails editing={editState} set={set} categories={cats} units={unitList} suppliers={suppliers} />
                    : <ViewDetails product={selected} categories={cats} units={unitList} />}
                  {variants !== null && variants.length > 0 && (
                    <div style={{ marginTop: '1.75rem' }}>
                      <SupplierAliasesSection
                        variants={variants}
                        editingSpId={editingSpId}
                        variantEdits={variantEdits}
                        variantError={variantError}
                        variantSaving={variantSaving}
                        onStartEdit={startEditVariant}
                        onCancelEdit={cancelEditVariant}
                        onChangeEdits={setVariantEdits}
                        onSave={saveVariant}
                        onSetPreferred={setPreferredVariant}
                      />
                    </div>
                  )}
                </>
              )}

              {activeTab === 'inventory' && (
                invLoading ? (
                  <Spinner />
                ) : !inventory ? null : inventory.balances.length === 0 ? (
                  <div style={{ color: '#6b7280', fontSize: '.9rem', padding: '1rem 0' }}>
                    No stock recorded for this product.
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
                      {[
                        { label: 'Total On Hand', value: `${inventory.total_on_hand % 1 === 0 ? inventory.total_on_hand : inventory.total_on_hand.toFixed(3)} ${inventory.unit ?? ''}`.trim() },
                        { label: 'Stock Value',   value: `€${inventory.stock_value.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
                        { label: 'Status',        value: inventory.stock_status.replace('_', ' ') },
                      ].map(s => (
                        <div key={s.label} style={{ flex: 1, minWidth: 120, padding: '.65rem 1rem', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8 }}>
                          <div style={{ fontSize: '.7rem', color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>{s.label}</div>
                          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#111827', marginTop: 2 }}>{s.value}</div>
                        </div>
                      ))}
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={{ padding: '.45rem .75rem', fontSize: '.75rem', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>Location</th>
                          <th style={{ padding: '.45rem .75rem', fontSize: '.75rem', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '2px solid #e5e7eb', textAlign: 'right' }}>Quantity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inventory.balances.map(b => (
                          <tr key={b.location_id}>
                            <td style={{ padding: '.5rem .75rem', fontSize: '.88rem', borderBottom: '1px solid #f3f4f6', color: '#374151' }}>{b.location_name}</td>
                            <td style={{ padding: '.5rem .75rem', fontSize: '.88rem', borderBottom: '1px solid #f3f4f6', textAlign: 'right', fontWeight: 600, color: b.quantity < 0 ? '#7c3aed' : b.quantity === 0 ? '#dc2626' : '#111827' }}>
                              {b.quantity % 1 === 0 ? b.quantity : b.quantity.toFixed(3)} {b.unit ?? inventory.unit ?? ''}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )
              )}

              {activeTab === 'history' && (
                history === null ? (
                  <div style={{ color: '#6b7280', fontSize: '.9rem', padding: '1rem 0' }}>Loading invoice history…</div>
                ) : history.length === 0 ? (
                  <div style={{ color: '#6b7280', fontSize: '.9rem', padding: '1rem 0' }}>
                    This product has not appeared on any invoice yet.
                  </div>
                ) : (
                  <>
                    <div style={{ marginBottom: '1rem', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '.75rem' }}>
                      {[
                        { label: 'Appearances', value: history.length },
                        { label: 'Total Qty',   value: history.reduce((s, h) => s + h.quantity, 0).toFixed(1) },
                        { label: 'Latest Price',value: `€${eur(history[0].unit_price)}` },
                      ].map(s => (
                        <div key={s.label} className="card" style={{ padding: '.75rem', textAlign: 'center' }}>
                          <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{s.value}</div>
                          <div style={{ fontSize: '.75rem', color: '#6b7280' }}>{s.label}</div>
                        </div>
                      ))}
                    </div>
                    <table>
                      <thead>
                        <tr>
                          <th>Invoice #</th><th>Date</th><th>Supplier</th>
                          <th>Qty</th><th>Unit</th><th>Unit Price</th>
                          <th>Disc%</th><th>Gross</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map(h => (
                          <tr key={h.id}>
                            <td style={{ fontFamily: 'monospace', fontSize: '.85rem' }}>{h.invoice_number}</td>
                            <td>{h.invoice_date}</td>
                            <td>{h.supplier_name}</td>
                            <td>{h.quantity}</td>
                            <td>{h.unit ?? '—'}</td>
                            <td>€{eur(h.unit_price)}</td>
                            <td>{h.discount_percent > 0 ? `${h.discount_percent}%` : '—'}</td>
                            <td>€{eur(h.line_gross_amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )
              )}

              {activeTab === 'cost' && (() => {
                if (costLoading) return <Spinner />
                if (!costHistory) return null
                if (costHistory.length === 0) return (
                  <div style={{ color: '#6b7280', fontSize: '.9rem', padding: '1rem 0' }}>
                    No purchase cost data for this product.
                  </div>
                )
                const prices = costHistory.map(h => h.unit_price)
                const latestPrice = prices[prices.length - 1]
                const minPrice = Math.min(...prices)
                const maxPrice = Math.max(...prices)
                const avgPrice = prices.reduce((s, p) => s + p, 0) / prices.length
                const firstPrice = prices[0]
                const totalChange = latestPrice - firstPrice
                const changePct = firstPrice > 0 ? ((totalChange / firstPrice) * 100) : null

                return (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '.75rem', marginBottom: '1.25rem' }}>
                      {[
                        { label: 'Latest Price', value: `€${eur(latestPrice)}` },
                        { label: 'Average', value: `€${eur(avgPrice)}` },
                        { label: 'Min', value: `€${eur(minPrice)}`, color: '#16a34a' },
                        {
                          label: 'Max', value: `€${eur(maxPrice)}`, color: '#dc2626',
                          sub: changePct != null
                            ? `${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}% vs first`
                            : undefined,
                        },
                      ].map(s => (
                        <div key={s.label} className="card" style={{ padding: '.75rem', textAlign: 'center' }}>
                          <div style={{ fontWeight: 700, fontSize: '1.05rem', color: s.color ?? '#111827' }}>{s.value}</div>
                          <div style={{ fontSize: '.72rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.03em' }}>{s.label}</div>
                          {s.sub && <div style={{ fontSize: '.72rem', color: changePct != null && changePct > 0 ? '#dc2626' : '#16a34a', marginTop: '.1rem' }}>{s.sub}</div>}
                        </div>
                      ))}
                    </div>
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th><th>Invoice #</th><th>Supplier</th>
                          <th>Qty</th><th>Unit Price</th><th>Disc%</th><th>Change</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...costHistory].reverse().map((h, idx, arr) => {
                          const prev = arr[idx + 1]
                          const delta = prev ? h.unit_price - prev.unit_price : null
                          const deltaPct = (prev && prev.unit_price > 0) ? (delta! / prev.unit_price) * 100 : null
                          return (
                            <tr key={`${h.invoice_date}-${h.invoice_number}`}>
                              <td>{h.invoice_date}</td>
                              <td style={{ fontFamily: 'monospace', fontSize: '.85rem' }}>{h.invoice_number}</td>
                              <td>{h.supplier_name}</td>
                              <td>{h.quantity} {h.unit ?? ''}</td>
                              <td style={{ fontWeight: 600 }}>€{eur(h.unit_price)}</td>
                              <td>{h.discount_percent > 0 ? `${h.discount_percent}%` : '—'}</td>
                              <td>
                                {delta == null ? <span style={{ color: '#9ca3af' }}>—</span> : (
                                  <span style={{ color: delta > 0 ? '#dc2626' : delta < 0 ? '#16a34a' : '#6b7280', fontWeight: 600, fontSize: '.82rem' }}>
                                    {delta > 0 ? '+' : ''}{eur(delta)} ({deltaPct != null ? `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%` : ''})
                                  </span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </>
                )
              })()}
            </div>

            {/* Footer */}
            <div style={{
              padding: '.9rem 1.5rem', borderTop: '1px solid #e5e7eb',
              display: 'flex', gap: '.75rem', justifyContent: 'flex-end', alignItems: 'center',
            }}>
              {isEditing ? (
                <>
                  {saveMutation.error && (
                    <span style={{ color: '#b91c1c', fontSize: '.85rem', flex: 1 }}>{saveMutation.error}</span>
                  )}
                  <button className="btn-secondary" onClick={cancelEdit} disabled={saveMutation.loading}>
                    Cancel Edit
                  </button>
                  <button
                    className="btn-primary"
                    disabled={saveMutation.loading}
                    onClick={() => saveMutation.mutate(undefined as void)}
                  >
                    {saveMutation.loading ? 'Saving…' : 'Save Changes'}
                  </button>
                </>
              ) : (
                <>
                  {!selected?.supplier_product_id && !confirmDelete && (
                    <button
                      onClick={() => setConfirmDelete(true)}
                      style={{
                        marginRight: 'auto', padding: '.35rem .75rem', background: 'white',
                        border: '1px solid #fca5a5', color: '#dc2626', borderRadius: 6,
                        fontSize: '.82rem', cursor: 'pointer',
                      }}
                    >
                      Delete Product
                    </button>
                  )}
                  {confirmDelete && (
                    <div style={{ marginRight: 'auto', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                      <span style={{ fontSize: '.82rem', color: '#374151' }}>Remove this product permanently?</span>
                      <button
                        onClick={() => deleteMutation.mutate(undefined as void)}
                        disabled={deleteMutation.loading}
                        style={{
                          padding: '.35rem .75rem', background: '#dc2626', color: 'white',
                          border: 'none', borderRadius: 6, fontSize: '.82rem', fontWeight: 600,
                          cursor: deleteMutation.loading ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {deleteMutation.loading ? 'Deleting…' : 'Yes, Delete'}
                      </button>
                      <button
                        onClick={() => { setConfirmDelete(false); deleteMutation.reset() }}
                        style={{
                          padding: '.35rem .75rem', background: 'white', border: '1px solid #d1d5db',
                          color: '#374151', borderRadius: 6, fontSize: '.82rem', cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                      {deleteMutation.error && (
                        <span style={{ color: '#dc2626', fontSize: '.8rem' }}>{deleteMutation.error}</span>
                      )}
                    </div>
                  )}
                  <button className="btn-secondary" onClick={closeModal}>Close</button>
                </>
              )}
            </div>

          </div>
        </>
      )}
    </div>
  )
}
