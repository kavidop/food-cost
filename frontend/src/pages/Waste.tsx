import { useState } from 'react'
import {
  listWaste, createWaste, updateWasteReason, getWasteAnalytics,
  exportWaste, getStockLocations, getCategories, getAllProducts,
} from '@/api/client'
import { useQuery }    from '@/hooks/useAsync'
import { useMutation } from '@/hooks/useMutation'
import Spinner from '@/components/Spinner'
import type { WasteEntry } from '@/types/api'
import { WASTE_REASON_CODES, WASTE_REASON_LABELS } from '@/types/api'

const eur = (n: number) =>
  n.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ── Reason badge ─────────────────────────────────────────────────────────────

const REASON_COLORS: Record<string, { bg: string; color: string }> = {
  expired:          { bg: '#fee2e2', color: '#991b1b' },
  damaged:          { bg: '#fef3c7', color: '#92400e' },
  overproduction:   { bg: '#dbeafe', color: '#1e40af' },
  preparation_loss: { bg: '#f3e8ff', color: '#6b21a8' },
  breakage:         { bg: '#d1fae5', color: '#065f46' },
}

function ReasonBadge({ reason }: { reason: string | null }) {
  if (!reason) return <span style={{ color: '#9ca3af' }}>—</span>
  const cfg = REASON_COLORS[reason] ?? { bg: '#f3f4f6', color: '#374151' }
  return (
    <span style={{
      display: 'inline-block', padding: '.15rem .55rem', borderRadius: 9999,
      fontSize: '.72rem', fontWeight: 600, letterSpacing: '.02em',
      background: cfg.bg, color: cfg.color,
    }}>
      {WASTE_REASON_LABELS[reason] ?? reason}
    </span>
  )
}

function Tile({ label, value, accent, sub }: {
  label: string; value: string | number; accent?: string; sub?: string
}) {
  return (
    <div style={{
      flex: 1, minWidth: 140, padding: '.75rem 1rem',
      background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8,
    }}>
      <div style={{ fontSize: '.72rem', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>
        {label}
      </div>
      <div style={{ fontSize: '1.3rem', fontWeight: 700, color: accent ?? '#111827', marginTop: 2 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '.72rem', color: '#6b7280', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// ── Analytics tab ─────────────────────────────────────────────────────────────

function AnalyticsTab({ dateFrom, dateTo, locationId }: {
  dateFrom: string; dateTo: string; locationId: number | ''
}) {
  const { data, loading, error } = useQuery(
    () => getWasteAnalytics({ date_from: dateFrom || undefined, date_to: dateTo || undefined, location_id: locationId || undefined }),
    [dateFrom, dateTo, locationId],
  )

  if (loading && !data) return <Spinner />
  if (error) return <p style={{ color: '#dc2626' }}>{error}</p>
  if (!data) return null

  const maxReasonValue = Math.max(...data.by_reason.map(r => r.total_value), 1)
  const maxTrendValue  = Math.max(...data.trend.map(t => t.total_value), 1)

  const th: React.CSSProperties = {
    padding: '.45rem .75rem', textAlign: 'left', fontSize: '.72rem', fontWeight: 700,
    color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em',
    borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap',
  }
  const td: React.CSSProperties = {
    padding: '.45rem .75rem', fontSize: '.85rem', color: '#374151',
    borderBottom: '1px solid #f3f4f6', verticalAlign: 'middle',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* Summary tiles */}
      <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap' }}>
        <Tile label="Total waste events" value={data.total_events} />
        <Tile label="Total waste value"  value={`€${eur(data.total_value)}`} accent="#dc2626" />
      </div>

      {/* By reason */}
      {data.by_reason.length > 0 && (
        <div>
          <div style={{ fontWeight: 600, fontSize: '.85rem', color: '#374151', marginBottom: '.75rem' }}>
            Waste by Reason
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            {data.by_reason.map(r => {
              const pct = maxReasonValue > 0 ? (r.total_value / maxReasonValue) * 100 : 0
              const cfg = REASON_COLORS[r.reason ?? ''] ?? { bg: '#e5e7eb', color: '#374151' }
              return (
                <div key={r.reason ?? 'unknown'} style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
                  <div style={{ width: 130, flexShrink: 0 }}>
                    <ReasonBadge reason={r.reason} />
                  </div>
                  <div style={{ flex: 1, background: '#f3f4f6', borderRadius: 4, height: 18, overflow: 'hidden' }}>
                    <div style={{
                      width: `${pct}%`, height: '100%',
                      background: cfg.color, borderRadius: 4, transition: 'width .3s',
                      opacity: .7,
                    }} />
                  </div>
                  <div style={{ width: 80, textAlign: 'right', fontSize: '.82rem', fontWeight: 600 }}>
                    €{eur(r.total_value)}
                  </div>
                  <div style={{ width: 55, textAlign: 'right', fontSize: '.78rem', color: '#6b7280' }}>
                    {r.count} event{r.count !== 1 ? 's' : ''}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 30-day trend */}
      {data.trend.length > 0 && (
        <div>
          <div style={{ fontWeight: 600, fontSize: '.85rem', color: '#374151', marginBottom: '.75rem' }}>
            Last 30 Days
          </div>
          <div style={{
            display: 'flex', alignItems: 'flex-end', gap: 3,
            height: 80, padding: '0 4px',
          }}>
            {data.trend.map(d => {
              const h = maxTrendValue > 0 ? Math.max(4, (d.total_value / maxTrendValue) * 76) : 4
              return (
                <div
                  key={d.date}
                  title={`${d.date}: €${eur(d.total_value)} (${d.event_count} events)`}
                  style={{
                    flex: 1, minWidth: 4, height: h, borderRadius: 2,
                    background: '#dc2626', opacity: .7, cursor: 'default',
                  }}
                />
              )
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.72rem', color: '#9ca3af', marginTop: 4 }}>
            <span>{data.trend[0]?.date}</span>
            <span>{data.trend[data.trend.length - 1]?.date}</span>
          </div>
        </div>
      )}

      {/* Top products */}
      {data.top_products.length > 0 && (
        <div>
          <div style={{ fontWeight: 600, fontSize: '.85rem', color: '#374151', marginBottom: '.75rem' }}>
            Top Wasted Products
          </div>
          <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
              <thead style={{ background: '#f9fafb' }}>
                <tr>
                  <th style={th}>#</th>
                  <th style={th}>Product</th>
                  <th style={th}>Category</th>
                  <th style={{ ...th, textAlign: 'right' }}>Events</th>
                  <th style={{ ...th, textAlign: 'right' }}>Total Qty</th>
                  <th style={{ ...th, textAlign: 'right' }}>Waste Value</th>
                </tr>
              </thead>
              <tbody>
                {data.top_products.map((p, i) => (
                  <tr key={p.product_id}
                    style={{ background: 'white' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#fef2f2')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'white')}
                  >
                    <td style={{ ...td, color: '#9ca3af', width: 32 }}>{i + 1}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{p.product_name}</td>
                    <td style={{ ...td, color: '#6b7280' }}>{p.category ?? '—'}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{p.event_count}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {p.total_quantity % 1 === 0 ? p.total_quantity : p.total_quantity.toFixed(2)} {p.unit ?? ''}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: '#dc2626' }}>
                      €{eur(p.total_value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.total_events === 0 && (
        <p style={{ color: '#6b7280', textAlign: 'center', padding: '2rem 0' }}>
          No waste recorded in this period.
        </p>
      )}
    </div>
  )
}

// ── Edit reason panel ─────────────────────────────────────────────────────────

function EditReasonPanel({
  entry, onClose, onSaved,
}: { entry: WasteEntry; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState<string>(entry.reason ?? '')
  const [notes,  setNotes]  = useState(entry.notes ?? '')
  const [error,  setError]  = useState<string | null>(null)

  const save = useMutation(async () => {
    await updateWasteReason(entry.id, reason || null, notes || null)
    onSaved()
    onClose()
  })

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.3)', zIndex: 60 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        background: 'white', borderRadius: 10, zIndex: 70,
        width: 360, boxShadow: '0 16px 48px rgba(0,0,0,.18)',
        padding: '1.25rem 1.5rem',
      }}>
        <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '.25rem' }}>Edit Waste Reason</div>
        <div style={{ fontSize: '.82rem', color: '#6b7280', marginBottom: '1rem' }}>{entry.product_name}</div>

        <label style={{ display: 'block', fontSize: '.82rem', fontWeight: 600, color: '#374151', marginBottom: '.3rem' }}>
          Reason Code
        </label>
        <select
          value={reason}
          onChange={e => setReason(e.target.value)}
          style={{ width: '100%', padding: '.4rem .6rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '.85rem', marginBottom: '.9rem' }}
        >
          <option value="">— No reason —</option>
          {WASTE_REASON_CODES.map(c => (
            <option key={c} value={c}>{WASTE_REASON_LABELS[c]}</option>
          ))}
        </select>

        <label style={{ display: 'block', fontSize: '.82rem', fontWeight: 600, color: '#374151', marginBottom: '.3rem' }}>
          Notes
        </label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          style={{ width: '100%', padding: '.4rem .6rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '.85rem', resize: 'vertical', boxSizing: 'border-box', marginBottom: '1rem' }}
        />

        {error && <p style={{ color: '#dc2626', fontSize: '.82rem', marginBottom: '.5rem' }}>{error}</p>}

        <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{ padding: '.4rem .85rem', background: 'white', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: '.82rem' }}
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              setError(null)
              try { await save.mutate(undefined) }
              catch (e: unknown) { setError(e instanceof Error ? e.message : 'Save failed') }
            }}
            disabled={save.loading}
            style={{ padding: '.4rem .85rem', background: '#111827', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '.82rem', fontWeight: 600 }}
          >
            {save.loading ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </>
  )
}

// ── Record waste panel ────────────────────────────────────────────────────────

function RecordWastePanel({ onClose, onSaved, locations }: {
  onClose: () => void
  onSaved: () => void
  locations: { id: number; name: string }[]
}) {
  const { data: products } = useQuery(getAllProducts)

  const [productId,  setProductId]  = useState<number | ''>('')
  const [locationId, setLocationId] = useState<number | ''>(locations[0]?.id ?? '')
  const [quantity,   setQuantity]   = useState('')
  const [reason,     setReason]     = useState('')
  const [notes,      setNotes]      = useState('')
  const [error,      setError]      = useState<string | null>(null)

  const save = useMutation(async () => {
    if (!productId)  throw new Error('Select a product')
    if (!locationId) throw new Error('Select a location')
    const qty = parseFloat(quantity)
    if (!qty || qty <= 0) throw new Error('Enter a valid quantity')
    await createWaste({
      product_id: productId as number,
      location_id: locationId as number,
      quantity: qty,
      reason: reason || null,
      notes: notes || null,
    })
    onSaved()
    onClose()
  })

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '.4rem .6rem', border: '1px solid #d1d5db',
    borderRadius: 6, fontSize: '.85rem', boxSizing: 'border-box',
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.3)', zIndex: 50 }} />
      <div style={{
        position: 'fixed', top: 0, right: 0, width: 400, height: '100vh',
        background: 'white', zIndex: 60, boxShadow: '-4px 0 24px rgba(0,0,0,.12)',
        padding: '1.5rem', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Record Waste</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: '#6b7280' }}>×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '.9rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '.82rem', fontWeight: 600, color: '#374151', marginBottom: '.3rem' }}>Product *</label>
            <select value={productId} onChange={e => setProductId(e.target.value === '' ? '' : Number(e.target.value))} style={inputStyle}>
              <option value="">Select product…</option>
              {(products ?? []).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '.82rem', fontWeight: 600, color: '#374151', marginBottom: '.3rem' }}>Location *</label>
            <select value={locationId} onChange={e => setLocationId(e.target.value === '' ? '' : Number(e.target.value))} style={inputStyle}>
              <option value="">Select location…</option>
              {locations.map(l => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '.82rem', fontWeight: 600, color: '#374151', marginBottom: '.3rem' }}>Quantity *</label>
            <input
              type="number" min="0.001" step="any" placeholder="0.00"
              value={quantity} onChange={e => setQuantity(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '.82rem', fontWeight: 600, color: '#374151', marginBottom: '.3rem' }}>Reason</label>
            <select value={reason} onChange={e => setReason(e.target.value)} style={inputStyle}>
              <option value="">— No reason —</option>
              {WASTE_REASON_CODES.map(c => (
                <option key={c} value={c}>{WASTE_REASON_LABELS[c]}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '.82rem', fontWeight: 600, color: '#374151', marginBottom: '.3rem' }}>Notes</label>
            <textarea
              value={notes} onChange={e => setNotes(e.target.value)}
              rows={3} placeholder="Optional details…"
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>
        </div>

        {error && <p style={{ color: '#dc2626', fontSize: '.82rem', margin: '.75rem 0 0' }}>{error}</p>}

        <button
          onClick={async () => {
            setError(null)
            try { await save.mutate(undefined) }
            catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed') }
          }}
          disabled={save.loading}
          style={{
            width: '100%', marginTop: '1.25rem', padding: '.6rem',
            background: '#111827', color: 'white', border: 'none',
            borderRadius: 6, cursor: 'pointer', fontSize: '.9rem', fontWeight: 600,
          }}
        >
          {save.loading ? 'Recording…' : 'Record Waste'}
        </button>
      </div>
    </>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Waste() {
  const [activeTab, setActiveTab] = useState<'log' | 'analytics'>('log')

  // Filters
  const [dateFrom,    setDateFrom]    = useState('')
  const [dateTo,      setDateTo]      = useState('')
  const [locationId,  setLocationId]  = useState<number | ''>('')
  const [categoryId,  setCategoryId]  = useState<number | ''>('')
  const [reasonFilter, setReasonFilter] = useState('')
  const [page,        setPage]        = useState(0)
  const limit = 50

  // Panels
  const [showRecord,  setShowRecord]  = useState(false)
  const [editEntry,   setEditEntry]   = useState<WasteEntry | null>(null)

  const { data: locations }  = useQuery(getStockLocations)
  const { data: categories } = useQuery(getCategories)

  const { data, loading, error, reload } = useQuery(
    () => listWaste({
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      location_id: locationId || undefined,
      category_id: categoryId || undefined,
      reason: reasonFilter || undefined,
      limit, offset: page * limit,
    }),
    [dateFrom, dateTo, locationId, categoryId, reasonFilter, page],
  )

  const doExport = useMutation(() => exportWaste({
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    location_id: locationId || undefined,
    category_id: categoryId || undefined,
    reason: reasonFilter || undefined,
  }))

  const entries    = data?.entries ?? []
  const total      = data?.total   ?? 0
  const totalPages = Math.ceil(total / limit)
  const totalValue = entries.reduce((s, e) => s + e.estimated_value, 0)

  const th: React.CSSProperties = {
    padding: '.5rem .75rem', textAlign: 'left', fontSize: '.72rem',
    fontWeight: 700, color: '#6b7280', textTransform: 'uppercase',
    letterSpacing: '.05em', borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap',
  }
  const td: React.CSSProperties = {
    padding: '.5rem .75rem', fontSize: '.85rem', color: '#374151',
    borderBottom: '1px solid #f3f4f6', verticalAlign: 'middle',
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700, color: '#111827' }}>Waste Management</h1>
          <p style={{ margin: '.2rem 0 0', color: '#6b7280', fontSize: '.85rem' }}>Track spoilage and loss across all products</p>
        </div>
        <div style={{ display: 'flex', gap: '.5rem' }}>
          {activeTab === 'log' && (
            <button
              onClick={() => doExport.mutate(undefined)}
              disabled={doExport.loading}
              style={{ padding: '.45rem .9rem', background: 'white', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: '.82rem', fontWeight: 500 }}
            >
              {doExport.loading ? 'Exporting…' : 'Export CSV'}
            </button>
          )}
          <button
            onClick={() => setShowRecord(true)}
            style={{ padding: '.45rem .9rem', background: '#111827', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '.82rem', fontWeight: 600 }}
          >
            + Record Waste
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', marginBottom: '1.25rem' }}>
        {(['log', 'analytics'] as const).map(t => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            style={{
              border: 'none', background: 'none', padding: '.65rem 1.25rem',
              fontWeight: activeTab === t ? 600 : 400,
              color: activeTab === t ? '#111827' : '#6b7280',
              borderBottom: activeTab === t ? '2px solid #111827' : '2px solid transparent',
              cursor: 'pointer', fontSize: '.88rem',
            }}
          >
            {t === 'log' ? 'Waste Log' : 'Analytics'}
          </button>
        ))}
      </div>

      {/* ── Log tab ──────────────────────────────────────────────────────────── */}
      {activeTab === 'log' && (
        <>
          {/* Filters */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: '.65rem', alignItems: 'center',
            padding: '.65rem .9rem', background: '#f9fafb', border: '1px solid #e5e7eb',
            borderRadius: 8, marginBottom: '1rem',
          }}>
            <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(0) }}
              style={{ padding: '.32rem .55rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '.82rem' }}
            />
            <span style={{ fontSize: '.8rem', color: '#9ca3af' }}>to</span>
            <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(0) }}
              style={{ padding: '.32rem .55rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '.82rem' }}
            />
            <select value={locationId} onChange={e => { setLocationId(e.target.value === '' ? '' : Number(e.target.value)); setPage(0) }}
              style={{ padding: '.32rem .55rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '.82rem' }}
            >
              <option value="">All locations</option>
              {(locations ?? []).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <select value={categoryId} onChange={e => { setCategoryId(e.target.value === '' ? '' : Number(e.target.value)); setPage(0) }}
              style={{ padding: '.32rem .55rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '.82rem' }}
            >
              <option value="">All categories</option>
              {(categories ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={reasonFilter} onChange={e => { setReasonFilter(e.target.value); setPage(0) }}
              style={{ padding: '.32rem .55rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '.82rem' }}
            >
              <option value="">All reasons</option>
              {WASTE_REASON_CODES.map(c => <option key={c} value={c}>{WASTE_REASON_LABELS[c]}</option>)}
            </select>
            {loading && <span style={{ fontSize: '.78rem', color: '#9ca3af', marginLeft: 'auto' }}>Loading…</span>}
          </div>

          {/* Summary tiles */}
          <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <Tile label="Events (page)"      value={entries.length} />
            <Tile label="Total (all filters)" value={total} />
            <Tile label="Waste value (page)"  value={`€${eur(totalValue)}`} accent="#dc2626" />
          </div>

          {error && <p style={{ color: '#dc2626' }}>{error}</p>}

          {entries.length === 0 && !loading ? (
            <p style={{ color: '#6b7280', textAlign: 'center', padding: '2rem 0' }}>No waste entries match the current filters.</p>
          ) : (
            <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
                <thead style={{ background: '#f9fafb' }}>
                  <tr>
                    <th style={th}>Date</th>
                    <th style={th}>Product</th>
                    <th style={th}>Category</th>
                    <th style={th}>Location</th>
                    <th style={{ ...th, textAlign: 'right' }}>Qty</th>
                    <th style={th}>Reason</th>
                    <th style={th}>Notes</th>
                    <th style={{ ...th, textAlign: 'right' }}>Est. Value</th>
                    <th style={{ ...th, textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(e => (
                    <tr key={e.id}
                      style={{ background: 'white' }}
                      onMouseEnter={ev => (ev.currentTarget.style.background = '#fef2f2')}
                      onMouseLeave={ev => (ev.currentTarget.style.background = 'white')}
                    >
                      <td style={{ ...td, whiteSpace: 'nowrap', color: '#6b7280' }}>{e.moved_at.slice(0, 10)}</td>
                      <td style={{ ...td, fontWeight: 600 }}>{e.product_name}</td>
                      <td style={{ ...td, color: '#6b7280' }}>{e.category ?? '—'}</td>
                      <td style={td}>{e.location_name}</td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        {e.quantity % 1 === 0 ? e.quantity : e.quantity.toFixed(2)} {e.unit ?? ''}
                      </td>
                      <td style={td}><ReasonBadge reason={e.reason} /></td>
                      <td style={{ ...td, color: '#6b7280', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {e.notes ?? <span style={{ color: '#9ca3af' }}>—</span>}
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 500, color: '#dc2626' }}>
                        {e.estimated_value > 0 ? `€${eur(e.estimated_value)}` : <span style={{ color: '#9ca3af' }}>—</span>}
                      </td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        <button
                          onClick={() => setEditEntry(e)}
                          style={{ padding: '.2rem .5rem', fontSize: '.72rem', cursor: 'pointer', background: 'white', border: '1px solid #d1d5db', borderRadius: 4, color: '#374151', fontWeight: 500 }}
                          onMouseEnter={ev => (ev.currentTarget.style.background = '#f3f4f6')}
                          onMouseLeave={ev => (ev.currentTarget.style.background = 'white')}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', gap: '.5rem', marginTop: '1rem', alignItems: 'center' }}>
              <button
                disabled={page <= 0}
                onClick={() => setPage(p => p - 1)}
                style={{ padding: '.3rem .7rem', border: '1px solid #d1d5db', borderRadius: 5, background: 'white', cursor: page <= 0 ? 'default' : 'pointer', fontSize: '.82rem' }}
              >
                ‹ Prev
              </button>
              <span style={{ fontSize: '.82rem', color: '#6b7280' }}>
                Page {page + 1} of {totalPages} · {total} total
              </span>
              <button
                disabled={page >= totalPages - 1}
                onClick={() => setPage(p => p + 1)}
                style={{ padding: '.3rem .7rem', border: '1px solid #d1d5db', borderRadius: 5, background: 'white', cursor: page >= totalPages - 1 ? 'default' : 'pointer', fontSize: '.82rem' }}
              >
                Next ›
              </button>
            </div>
          )}
        </>
      )}

      {/* ── Analytics tab ─────────────────────────────────────────────────── */}
      {activeTab === 'analytics' && (
        <>
          {/* Analytics filters (date + location only) */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: '.65rem', alignItems: 'center',
            padding: '.65rem .9rem', background: '#f9fafb', border: '1px solid #e5e7eb',
            borderRadius: 8, marginBottom: '1.25rem',
          }}>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              style={{ padding: '.32rem .55rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '.82rem' }}
            />
            <span style={{ fontSize: '.8rem', color: '#9ca3af' }}>to</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              style={{ padding: '.32rem .55rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '.82rem' }}
            />
            <select value={locationId} onChange={e => setLocationId(e.target.value === '' ? '' : Number(e.target.value))}
              style={{ padding: '.32rem .55rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '.82rem' }}
            >
              <option value="">All locations</option>
              {(locations ?? []).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <AnalyticsTab dateFrom={dateFrom} dateTo={dateTo} locationId={locationId} />
        </>
      )}

      {/* Panels */}
      {showRecord && (
        <RecordWastePanel
          locations={locations ?? []}
          onClose={() => setShowRecord(false)}
          onSaved={() => reload()}
        />
      )}
      {editEntry && (
        <EditReasonPanel
          entry={editEntry}
          onClose={() => setEditEntry(null)}
          onSaved={() => reload()}
        />
      )}
    </div>
  )
}
