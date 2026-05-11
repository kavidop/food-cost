import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@/hooks/useAsync'
import { useMutation } from '@/hooks/useMutation'
import {
  listMovements, exportMovements, createAdjustment,
  receiveStock, voidMovement, getStockLocations, getAllProducts,
} from '@/api/client'
import type { MovementWithBalance, ProductPickerItem, StockLocation, AdjustmentResult } from '@/types/api'

const PAGE_SIZE = 50

const MT_LABEL: Record<string, string> = {
  purchase_receipt:       'Purchase Receipt',
  adjustment_up:          'Adjustment (+)',
  adjustment_down:        'Adjustment (−)',
  waste:                  'Waste',
  transfer_out:           'Transfer Out',
  transfer_in:            'Transfer In',
  production_consumption: 'Production Use',
  production_output:      'Production Output',
  count_reconciliation:   'Count Reconciliation',
  opening:                'Opening Stock',
  return_to_supplier:     'Return to Supplier',
  receipt_pending:        'Pending Receipt',
}

const MT_COLOR: Record<string, string> = {
  purchase_receipt:       '#0d6efd',
  adjustment_up:          '#198754',
  adjustment_down:        '#dc3545',
  waste:                  '#6f42c1',
  transfer_out:           '#fd7e14',
  transfer_in:            '#20c997',
  production_consumption: '#6c757d',
  production_output:      '#0dcaf0',
  count_reconciliation:   '#ffc107',
  opening:                '#adb5bd',
  return_to_supplier:     '#dc3545',
  receipt_pending:        '#0d6efd',
}

const ALL_TYPES = Object.keys(MT_LABEL)

function eur(n: number | null) {
  if (n == null) return '—'
  return n.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span style={{
      background: MT_COLOR[type] ?? '#6c757d',
      color: '#fff',
      borderRadius: 4,
      padding: '2px 7px',
      fontSize: 11,
      fontWeight: 600,
      whiteSpace: 'nowrap',
    }}>
      {MT_LABEL[type] ?? type}
    </span>
  )
}

// ── Product select with search ─────────────────────────────────────────────

function ProductSelect({
  products,
  value,
  onChange,
  placeholder = 'All products',
}: {
  products: ProductPickerItem[]
  value: number | ''
  onChange: (v: number | '') => void
  placeholder?: string
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [search, setSearch] = useState('')
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current) return
      if (!wrapRef.current.contains(e.target as Node)) setIsOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const selectedName = value ? products.find(p => p.id === value)?.name ?? '' : ''
  const filtered = search
    ? products.filter(p => p.name.toLowerCase().includes(search.toLowerCase())).slice(0, 50)
    : products.slice(0, 100)

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        type="text"
        placeholder={placeholder}
        value={search || selectedName}
        onFocus={() => setIsOpen(true)}
        onChange={e => {
          setSearch(e.target.value)
          setIsOpen(true)
          if (!e.target.value) onChange('')
        }}
        style={{ width: '100%', padding: '6px 10px', border: '1px solid #dee2e6', borderRadius: 4, fontSize: 13 }}
      />

      {isOpen && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0,
          background: '#fff', border: '1px solid #dee2e6', borderRadius: 4,
          boxShadow: '0 4px 12px rgba(0,0,0,.1)', zIndex: 100,
          maxHeight: 220, overflowY: 'auto',
        }}>
          {!search && (
            <div
              onClick={() => { onChange(''); setSearch(''); setIsOpen(false) }}
              style={{ padding: '7px 12px', cursor: 'pointer', fontSize: 13, color: '#6c757d' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f8f9fa')}
              onMouseLeave={e => (e.currentTarget.style.background = '')}
            >
              All products
            </div>
          )}

          {filtered.length === 0 && (
            <div style={{ padding: '8px 12px', color: '#6c757d', fontSize: 13 }}>No results</div>
          )}
          {filtered.map(p => (
            <div
              key={p.id}
              onClick={() => { onChange(p.id); setSearch(''); setIsOpen(false) }}
              style={{
                padding: '7px 12px', cursor: 'pointer', fontSize: 13,
                background: value === p.id ? '#f0f4ff' : undefined,
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f8f9fa')}
              onMouseLeave={e => (e.currentTarget.style.background = value === p.id ? '#f0f4ff' : '')}
            >
              {p.name}
              {p.unit && <span style={{ color: '#6c757d', marginLeft: 6 }}>({p.unit})</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Adjustment modal ───────────────────────────────────────────────────────

function AdjustmentModal({
  products,
  locations,
  onClose,
  onSuccess,
}: {
  products: ProductPickerItem[]
  locations: StockLocation[]
  onClose: () => void
  onSuccess: () => void
}) {
  const [productId,  setProductId]  = useState<number | ''> ('')
  const [locationId, setLocationId] = useState<number | ''> ('')
  const [direction,  setDirection]  = useState<'up' | 'down'>('up')
  const [quantity,   setQuantity]   = useState('')
  const [reason,     setReason]     = useState('')
  const [notes,      setNotes]      = useState('')
  const [negWarn, setNegWarn] = useState<AdjustmentResult | null>(null)

  const { mutate, loading, error, reset } = useMutation(createAdjustment)

  const submit = useCallback(async (allowNegative = false) => {
    if (!productId || !locationId || !quantity) return
    reset()
    setNegWarn(null)
    const result = await mutate({
      product_id: productId,
      location_id: locationId,
      direction,
      quantity: parseFloat(quantity),
      reason: reason || null,
      notes: notes || null,
      allow_negative: allowNegative,
    })
    if (!result) return
    if (!result.success && result.warning === 'negative_stock') {
      setNegWarn(result)
    } else if (result.success) {
      onSuccess()
      onClose()
    }
  }, [productId, locationId, direction, quantity, reason, notes, mutate, reset, onSuccess, onClose])

  const unit = products.find(p => p.id === productId)?.unit ?? ''

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.45)' }} />
      <div style={{ position: 'relative', background: '#fff', borderRadius: 8, padding: 28, width: 460, boxShadow: '0 8px 32px rgba(0,0,0,.18)' }}>
        <h3 style={{ margin: '0 0 20px', fontSize: 17 }}>Record Adjustment</h3>

        <label style={{ display: 'block', marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#6c757d' }}>PRODUCT</div>
          <ProductSelect products={products} value={productId} onChange={setProductId} placeholder="Select product…" />
        </label>

        <label style={{ display: 'block', marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#6c757d' }}>LOCATION</div>
          <select
            value={locationId}
            onChange={e => setLocationId(e.target.value ? Number(e.target.value) : '')}
            style={{ width: '100%', padding: '6px 10px', border: '1px solid #dee2e6', borderRadius: 4, fontSize: 13 }}
          >
            <option value="">Select location…</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          <label>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#6c757d' }}>DIRECTION</div>
            <select
              value={direction}
              onChange={e => setDirection(e.target.value as 'up' | 'down')}
              style={{ width: '100%', padding: '6px 10px', border: '1px solid #dee2e6', borderRadius: 4, fontSize: 13 }}
            >
              <option value="up">Add stock (+)</option>
              <option value="down">Remove stock (−)</option>
            </select>
          </label>
          <label>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#6c757d' }}>QUANTITY {unit && `(${unit})`}</div>
            <input
              type="number" min="0.001" step="any"
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              style={{ width: '100%', padding: '6px 10px', border: '1px solid #dee2e6', borderRadius: 4, fontSize: 13, boxSizing: 'border-box' }}
            />
          </label>
        </div>

        <label style={{ display: 'block', marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#6c757d' }}>REASON</div>
          <input
            type="text" value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="e.g. Spoilage, Count correction…"
            style={{ width: '100%', padding: '6px 10px', border: '1px solid #dee2e6', borderRadius: 4, fontSize: 13, boxSizing: 'border-box' }}
          />
        </label>

        <label style={{ display: 'block', marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#6c757d' }}>NOTES</div>
          <textarea
            value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            style={{ width: '100%', padding: '6px 10px', border: '1px solid #dee2e6', borderRadius: 4, fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
          />
        </label>

        {negWarn && (
          <div style={{ background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 6, padding: 12, marginBottom: 16, fontSize: 13 }}>
            <strong>Warning: negative stock</strong>
            <div style={{ marginTop: 4 }}>
              Current: <strong>{eur(negWarn.current_stock)}</strong> {unit} →
              Resulting: <strong style={{ color: '#dc3545' }}>{eur(negWarn.resulting_stock)}</strong> {unit}
            </div>
            <button
              onClick={() => submit(true)}
              disabled={loading}
              style={{ marginTop: 10, padding: '6px 14px', background: '#dc3545', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}
            >
              Allow Negative Stock
            </button>
          </div>
        )}

        {error && <div style={{ color: '#dc3545', fontSize: 13, marginBottom: 12 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={{ padding: '8px 18px', border: '1px solid #dee2e6', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 13 }}>
            Cancel
          </button>
          <button
            onClick={() => submit(false)}
            disabled={loading || !productId || !locationId || !quantity}
            style={{ padding: '8px 18px', background: '#0d6efd', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13, opacity: (loading || !productId || !locationId || !quantity) ? 0.6 : 1 }}
          >
            {loading ? 'Saving…' : 'Record Adjustment'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Receive stock modal ────────────────────────────────────────────────────

function ReceiveModal({
  products,
  locations,
  onClose,
  onSuccess,
}: {
  products: ProductPickerItem[]
  locations: StockLocation[]
  onClose: () => void
  onSuccess: () => void
}) {
  const [productId,  setProductId]  = useState<number | ''>('')
  const [locationId, setLocationId] = useState<number | ''>('')
  const [quantity,   setQuantity]   = useState('')
  const [notes,      setNotes]      = useState('')

  const { mutate, loading, error } = useMutation(receiveStock)

  const submit = async () => {
    if (!productId || !locationId || !quantity) return
    const result = await mutate({ product_id: productId, location_id: locationId, quantity: parseFloat(quantity), notes: notes || null })
    if (result !== null) { onSuccess(); onClose() }
  }

  const unit = products.find(p => p.id === productId)?.unit ?? ''

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.45)' }} />
      <div style={{ position: 'relative', background: '#fff', borderRadius: 8, padding: 28, width: 420, boxShadow: '0 8px 32px rgba(0,0,0,.18)' }}>
        <h3 style={{ margin: '0 0 20px', fontSize: 17 }}>Receive Stock</h3>

        <label style={{ display: 'block', marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#6c757d' }}>PRODUCT</div>
          <ProductSelect products={products} value={productId} onChange={setProductId} placeholder="Select product…" />
        </label>

        <label style={{ display: 'block', marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#6c757d' }}>LOCATION</div>
          <select
            value={locationId}
            onChange={e => setLocationId(e.target.value ? Number(e.target.value) : '')}
            style={{ width: '100%', padding: '6px 10px', border: '1px solid #dee2e6', borderRadius: 4, fontSize: 13 }}
          >
            <option value="">Select location…</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>

        <label style={{ display: 'block', marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#6c757d' }}>QUANTITY {unit && `(${unit})`}</div>
          <input
            type="number" min="0.001" step="any"
            value={quantity}
            onChange={e => setQuantity(e.target.value)}
            style={{ width: '100%', padding: '6px 10px', border: '1px solid #dee2e6', borderRadius: 4, fontSize: 13, boxSizing: 'border-box' }}
          />
        </label>

        <label style={{ display: 'block', marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#6c757d' }}>NOTES</div>
          <textarea
            value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            style={{ width: '100%', padding: '6px 10px', border: '1px solid #dee2e6', borderRadius: 4, fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
          />
        </label>

        {error && <div style={{ color: '#dc3545', fontSize: 13, marginBottom: 12 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={{ padding: '8px 18px', border: '1px solid #dee2e6', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
          <button
            onClick={submit}
            disabled={loading || !productId || !locationId || !quantity}
            style={{ padding: '8px 18px', background: '#198754', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13, opacity: (loading || !productId || !locationId || !quantity) ? 0.6 : 1 }}
          >
            {loading ? 'Saving…' : 'Receive Stock'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Void confirm dialog ────────────────────────────────────────────────────

function VoidDialog({
  movement,
  onClose,
  onSuccess,
}: {
  movement: MovementWithBalance
  onClose: () => void
  onSuccess: () => void
}) {
  const { mutate, loading, error } = useMutation((id: number) => voidMovement(id))

  const submit = async () => {
    const result = await mutate(movement.id)
    if (!result) return
    if (result.success) { onSuccess(); onClose() }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 90, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.45)' }} />
      <div style={{ position: 'relative', background: '#fff', borderRadius: 8, padding: 28, width: 400, boxShadow: '0 8px 32px rgba(0,0,0,.18)' }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 17 }}>Void Movement #{movement.id}</h3>
        <p style={{ fontSize: 13, color: '#495057', marginBottom: 8 }}>
          This will create a counter-entry reversing:
        </p>
        <div style={{ background: '#f8f9fa', borderRadius: 6, padding: 12, fontSize: 13, marginBottom: 16 }}>
          <div><strong>{movement.product_name}</strong></div>
          <div style={{ marginTop: 4, color: '#6c757d' }}>
            <TypeBadge type={movement.movement_type} />
            {' '}
            <span style={{ color: movement.quantity > 0 ? '#198754' : '#dc3545' }}>
              {movement.quantity > 0 ? '+' : ''}{eur(movement.quantity)} {movement.unit}
            </span>
            {' @ '}{movement.location_name}
          </div>
        </div>
        {error && <div style={{ color: '#dc3545', fontSize: 13, marginBottom: 12 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={{ padding: '8px 18px', border: '1px solid #dee2e6', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
          <button
            onClick={submit}
            disabled={loading}
            style={{ padding: '8px 18px', background: '#dc3545', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}
          >
            {loading ? 'Voiding…' : 'Confirm Void'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function Movements() {
  const navigate = useNavigate()

  const [dateFrom,  setDateFrom]  = useState('')
  const [dateTo,    setDateTo]    = useState('')
  const [mtFilter,  setMtFilter]  = useState('')
  const [locFilter, setLocFilter] = useState<number | ''>('')
  const [prodFilter, setProdFilter] = useState<number | ''>('')
  const [page,      setPage]      = useState(0)

  const [showAdjust,  setShowAdjust]  = useState(false)
  const [showReceive, setShowReceive] = useState(false)
  const [voidTarget,  setVoidTarget]  = useState<MovementWithBalance | null>(null)

  const params = { date_from: dateFrom || undefined, date_to: dateTo || undefined, movement_type: mtFilter || undefined, location_id: locFilter || undefined, product_id: prodFilter || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE }

  const { data, loading, reload } = useQuery(
    () => listMovements(params),
    [dateFrom, dateTo, mtFilter, locFilter, prodFilter, page],
  )
  const { data: locations } = useQuery(getStockLocations, [])
  const { data: products }  = useQuery(getAllProducts, [])

  const movements  = data?.movements ?? []
  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0

  const handleSuccess = () => { setPage(0); reload() }

  const clearFilters = () => {
    setDateFrom(''); setDateTo(''); setMtFilter(''); setLocFilter(''); setProdFilter(''); setPage(0)
  }

  const hasFilters = dateFrom || dateTo || mtFilter || locFilter || prodFilter

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Stock Movements</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => exportMovements(params)}
            style={{ padding: '8px 16px', border: '1px solid #dee2e6', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 13 }}
          >
            Export CSV
          </button>
          <button
            onClick={() => setShowReceive(true)}
            style={{ padding: '8px 16px', background: '#198754', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}
          >
            Receive Stock
          </button>
          <button
            onClick={() => setShowAdjust(true)}
            style={{ padding: '8px 16px', background: '#0d6efd', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}
          >
            Record Adjustment
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#6c757d' }}>FROM</span>
          <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(0) }}
            style={{ padding: '6px 10px', border: '1px solid #dee2e6', borderRadius: 4, fontSize: 13 }} />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#6c757d' }}>TO</span>
          <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(0) }}
            style={{ padding: '6px 10px', border: '1px solid #dee2e6', borderRadius: 4, fontSize: 13 }} />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#6c757d' }}>TYPE</span>
          <select value={mtFilter} onChange={e => { setMtFilter(e.target.value); setPage(0) }}
            style={{ padding: '6px 10px', border: '1px solid #dee2e6', borderRadius: 4, fontSize: 13 }}>
            <option value="">All types</option>
            {ALL_TYPES.map(t => <option key={t} value={t}>{MT_LABEL[t]}</option>)}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#6c757d' }}>LOCATION</span>
          <select value={locFilter} onChange={e => { setLocFilter(e.target.value ? Number(e.target.value) : ''); setPage(0) }}
            style={{ padding: '6px 10px', border: '1px solid #dee2e6', borderRadius: 4, fontSize: 13 }}>
            <option value="">All locations</option>
            {(locations ?? []).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 200 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#6c757d' }}>PRODUCT</span>
          <ProductSelect
            products={products ?? []}
            value={prodFilter}
            onChange={v => { setProdFilter(v); setPage(0) }}
          />
        </div>

        {hasFilters && (
          <button onClick={clearFilters}
            style={{ padding: '6px 14px', border: '1px solid #dee2e6', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 13, alignSelf: 'flex-end' }}>
            Clear
          </button>
        )}
      </div>

      {/* Summary */}
      {data && (
        <div style={{ fontSize: 13, color: '#6c757d', marginBottom: 12 }}>
          {data.total.toLocaleString()} movement{data.total !== 1 ? 's' : ''}
          {totalPages > 1 && ` · page ${page + 1} of ${totalPages}`}
        </div>
      )}

      {/* Table */}
      {loading && !data && <div style={{ color: '#6c757d', padding: 24 }}>Loading…</div>}
      {data && movements.length === 0 && (
        <div style={{ color: '#6c757d', padding: 24, textAlign: 'center' }}>No movements found</div>
      )}
      {movements.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #dee2e6', textAlign: 'left' }}>
                {['Date/Time', 'Product', 'Type', 'Qty', 'Location', 'Before', 'After', 'Reason / Source', ''].map(h => (
                  <th key={h} style={{ padding: '8px 10px', fontWeight: 600, fontSize: 11, color: '#6c757d', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {movements.map(m => {
                const voided   = m.is_voided
                const isVoidEntry = m.reference_type === 'void'
                const rowStyle = voided || isVoidEntry
                  ? { opacity: 0.55, textDecoration: voided ? 'line-through' : undefined }
                  : {}

                return (
                  <tr key={m.id} style={{ borderBottom: '1px solid #f1f3f5', ...rowStyle }}>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: '#6c757d' }}>
                      {new Date(m.moved_at).toLocaleString('el-GR', { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <button
                        onClick={() => navigate(`/inventory/${m.product_id}`)}
                        style={{ background: 'none', border: 'none', color: '#0d6efd', cursor: 'pointer', padding: 0, fontSize: 13, textAlign: 'left' }}
                      >
                        {m.product_name}
                      </button>
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <TypeBadge type={m.movement_type} />
                      {isVoidEntry && <span style={{ fontSize: 10, color: '#6c757d', marginLeft: 4 }}>VOID</span>}
                    </td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', fontWeight: 600, color: m.quantity > 0 ? '#198754' : '#dc3545' }}>
                      {m.quantity > 0 ? '+' : ''}{eur(m.quantity)} {m.unit}
                    </td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{m.location_name ?? '—'}</td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', textAlign: 'right', color: '#6c757d' }}>
                      {eur(m.balance_before)}
                    </td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', textAlign: 'right', fontWeight: 500 }}>
                      {eur(m.balance_after)}
                    </td>
                    <td style={{ padding: '8px 10px', color: '#6c757d', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.invoice_number
                        ? <button onClick={() => navigate(`/invoices`)} style={{ background: 'none', border: 'none', color: '#0d6efd', cursor: 'pointer', padding: 0, fontSize: 13 }}>#{m.invoice_number}</button>
                        : m.reason ?? (isVoidEntry ? `Void of #${m.reference_id}` : '—')
                      }
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      {!voided && !isVoidEntry && (
                        <button
                          onClick={() => setVoidTarget(m)}
                          style={{ padding: '3px 10px', background: '#fff', border: '1px solid #dee2e6', borderRadius: 4, cursor: 'pointer', fontSize: 12, color: '#6c757d' }}
                        >
                          Void
                        </button>
                      )}
                      {voided && <span style={{ fontSize: 11, color: '#6c757d' }}>Voided</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 20 }}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            style={{ padding: '6px 14px', border: '1px solid #dee2e6', borderRadius: 4, cursor: page === 0 ? 'not-allowed' : 'pointer', background: '#fff', fontSize: 13 }}>
            ← Prev
          </button>
          <span style={{ padding: '6px 12px', fontSize: 13, color: '#6c757d' }}>{page + 1} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
            style={{ padding: '6px 14px', border: '1px solid #dee2e6', borderRadius: 4, cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer', background: '#fff', fontSize: 13 }}>
            Next →
          </button>
        </div>
      )}

      {/* Modals */}
      {showAdjust && (
        <AdjustmentModal
          products={products ?? []}
          locations={locations ?? []}
          onClose={() => setShowAdjust(false)}
          onSuccess={handleSuccess}
        />
      )}
      {showReceive && (
        <ReceiveModal
          products={products ?? []}
          locations={locations ?? []}
          onClose={() => setShowReceive(false)}
          onSuccess={handleSuccess}
        />
      )}
      {voidTarget && (
        <VoidDialog
          movement={voidTarget}
          onClose={() => setVoidTarget(null)}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  )
}
