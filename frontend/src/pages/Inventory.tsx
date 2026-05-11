import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getInventoryOverview, exportInventoryOverview,
  getStockLocations, getCategories, getSuppliers,
  createLocation, updateLocation,
} from '@/api/client'
import { useQuery }    from '@/hooks/useAsync'
import { useMutation } from '@/hooks/useMutation'
import Spinner from '@/components/Spinner'
import type { InventoryOverviewItem, StockLocation } from '@/types/api'

const eur = (n: number) =>
  n.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const qty = (n: number, unit: string | null) =>
  `${n % 1 === 0 ? n : n.toFixed(2)} ${unit ?? ''}`

// ── Status badge ─────────────────────────────────────────────────────────────

const STATUS_CFG = {
  ok:          { label: 'OK',          bg: '#d1fae5', color: '#065f46' },
  low_stock:   { label: 'Low stock',   bg: '#fef3c7', color: '#92400e' },
  out_of_stock:{ label: 'Out of stock',bg: '#fee2e2', color: '#991b1b' },
  negative:    { label: 'Negative',    bg: '#f3e8ff', color: '#6b21a8' },
} as const

function StatusBadge({ status }: { status: InventoryOverviewItem['stock_status'] }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.ok
  return (
    <span style={{
      display: 'inline-block', padding: '.15rem .55rem', borderRadius: 9999,
      fontSize: '.72rem', fontWeight: 600, letterSpacing: '.02em',
      background: cfg.bg, color: cfg.color,
    }}>
      {cfg.label}
    </span>
  )
}

// ── Warning dots ─────────────────────────────────────────────────────────────

function Warn({ title }: { title: string }) {
  return (
    <span title={title} style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: '#f59e0b', marginLeft: 4, verticalAlign: 'middle',
    }} />
  )
}

// ── Summary tile ─────────────────────────────────────────────────────────────

function Tile({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
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
    </div>
  )
}

// ── Action button ─────────────────────────────────────────────────────────────

function ActionBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: '.2rem .5rem', fontSize: '.72rem', cursor: 'pointer',
      background: 'white', border: '1px solid #d1d5db', borderRadius: 4,
      color: '#374151', fontWeight: 500,
    }}
    onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
    onMouseLeave={e => (e.currentTarget.style.background = 'white')}
    >
      {label}
    </button>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Inventory() {
  const navigate = useNavigate()
  const [locationId,     setLocationId]     = useState<number | ''>('')
  const [categoryId,     setCategoryId]     = useState<number | ''>('')
  const [supplierId,     setSupplierId]     = useState<number | ''>('')
  const [lowStockOnly,   setLowStockOnly]   = useState(false)
  const [includeInactive,setIncludeInactive]= useState(false)

  // Locations panel state
  const [showLocations, setShowLocations]     = useState(false)
  const [editingId,     setEditingId]         = useState<number | null>(null)
  const [editName,      setEditName]          = useState('')
  const [editSort,      setEditSort]          = useState(0)
  const [editActive,    setEditActive]        = useState(1)
  const [newName,       setNewName]           = useState('')
  const [newSort,       setNewSort]           = useState(0)
  const [locError,      setLocError]          = useState<string | null>(null)

  const { data: locations, reload: reloadLocations } = useQuery(getStockLocations)
  const { data: categories } = useQuery(getCategories)
  const { data: suppliers  } = useQuery(getSuppliers)

  const { data, loading, error } = useQuery(
    () => getInventoryOverview({
      location_id:      locationId,
      category_id:      categoryId,
      supplier_id:      supplierId,
      low_stock_only:   lowStockOnly,
      include_inactive: includeInactive,
    }),
    [locationId, categoryId, supplierId, lowStockOnly, includeInactive],
  )

  const doExport = useMutation(async () => {
    await exportInventoryOverview({
      location_id:      locationId,
      category_id:      categoryId,
      supplier_id:      supplierId,
      low_stock_only:   lowStockOnly,
      include_inactive: includeInactive,
    })
  })

  const doAddLocation = useMutation(async () => {
    if (!newName.trim()) throw new Error('Name is required')
    await createLocation({ name: newName.trim(), sort_order: newSort })
    setNewName('')
    setNewSort(0)
    reloadLocations()
  })

  const doSaveLocation = useMutation(async (id: number) => {
    if (!editName.trim()) throw new Error('Name is required')
    await updateLocation(id, { name: editName.trim(), sort_order: editSort, is_active: editActive })
    setEditingId(null)
    reloadLocations()
  })

  const handleAddLocation = async () => {
    setLocError(null)
    try { await doAddLocation.mutate(undefined) }
    catch (e) { setLocError(e instanceof Error ? e.message : 'Failed to add') }
  }

  const handleSaveLocation = async (id: number) => {
    setLocError(null)
    try { await doSaveLocation.mutate(id) }
    catch (e) { setLocError(e instanceof Error ? e.message : 'Failed to save') }
  }

  const startEdit = (loc: StockLocation) => {
    setEditingId(loc.id)
    setEditName(loc.name)
    setEditSort(loc.sort_order)
    setEditActive(loc.is_active)
    setLocError(null)
  }

  if (loading && !data) return <Spinner />
  if (error)            return <p style={{ color: '#dc2626' }}>{error}</p>

  const rows = data ?? []

  // ── Summary stats ──────────────────────────────────────────────────────────
  const outOfStock = rows.filter(r => r.stock_status === 'out_of_stock').length
  const lowStock   = rows.filter(r => r.stock_status === 'low_stock').length
  const negative   = rows.filter(r => r.stock_status === 'negative').length
  const totalValue = rows.reduce((s, r) => s + (r.stock_value ?? 0), 0)

  // ── Th helper ─────────────────────────────────────────────────────────────
  const th: React.CSSProperties = {
    padding: '.5rem .75rem', textAlign: 'left', fontSize: '.72rem',
    fontWeight: 700, color: '#6b7280', textTransform: 'uppercase',
    letterSpacing: '.05em', borderBottom: '2px solid #e5e7eb',
    whiteSpace: 'nowrap',
  }
  const td: React.CSSProperties = {
    padding: '.55rem .75rem', fontSize: '.85rem', color: '#374151',
    borderBottom: '1px solid #f3f4f6', verticalAlign: 'middle',
  }

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700, color: '#111827' }}>
            Inventory Overview
          </h1>
          <p style={{ margin: '.2rem 0 0', color: '#6b7280', fontSize: '.85rem' }}>
            Daily stock visibility across all products
          </p>
        </div>
        <div style={{ display: 'flex', gap: '.5rem' }}>
          <button
            onClick={() => setShowLocations(true)}
            style={{
              padding: '.5rem 1rem', background: 'white', color: '#374151',
              border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: '.85rem', fontWeight: 600,
            }}
          >
            Locations
          </button>
          <button
            onClick={() => doExport.mutate(undefined)}
            disabled={doExport.loading}
            style={{
              padding: '.5rem 1rem', background: '#111827', color: 'white',
              border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '.85rem', fontWeight: 600,
            }}
          >
            {doExport.loading ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
      </div>

      {/* ── Filters ────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '.75rem', alignItems: 'center',
        padding: '.75rem 1rem', background: '#f9fafb', border: '1px solid #e5e7eb',
        borderRadius: 8, marginBottom: '1rem',
      }}>
        <select
          value={locationId}
          onChange={e => setLocationId(e.target.value === '' ? '' : Number(e.target.value))}
          style={{ padding: '.35rem .6rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '.85rem' }}
        >
          <option value="">All locations</option>
          {(locations ?? []).map(l => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>

        <select
          value={categoryId}
          onChange={e => setCategoryId(e.target.value === '' ? '' : Number(e.target.value))}
          style={{ padding: '.35rem .6rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '.85rem' }}
        >
          <option value="">All categories</option>
          {(categories ?? []).sort((a, b) => a.name.localeCompare(b.name)).map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <select
          value={supplierId}
          onChange={e => setSupplierId(e.target.value === '' ? '' : Number(e.target.value))}
          style={{ padding: '.35rem .6rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '.85rem' }}
        >
          <option value="">All suppliers</option>
          {(suppliers ?? []).filter((s, i, arr) => {
            const label = s.trade_name ?? s.name
            return arr.findIndex(x => (x.trade_name ?? x.name) === label) === i
          }).map(s => (
            <option key={s.id} value={s.id}>{s.trade_name ?? s.name}</option>
          ))}
        </select>

        <label style={{ display: 'flex', alignItems: 'center', gap: '.35rem', fontSize: '.85rem', cursor: 'pointer' }}>
          <input
            type="checkbox" checked={lowStockOnly}
            onChange={e => setLowStockOnly(e.target.checked)}
          />
          Low stock only
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: '.35rem', fontSize: '.85rem', cursor: 'pointer' }}>
          <input
            type="checkbox" checked={includeInactive}
            onChange={e => setIncludeInactive(e.target.checked)}
          />
          Include inactive
        </label>

        {loading && (
          <span style={{ fontSize: '.8rem', color: '#9ca3af', marginLeft: 'auto' }}>Refreshing…</span>
        )}
      </div>

      {/* ── Summary tiles ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <Tile label="Products"     value={rows.length} />
        <Tile label="Out of stock" value={outOfStock} accent={outOfStock > 0 ? '#dc2626' : undefined} />
        <Tile label="Low stock"    value={lowStock}   accent={lowStock   > 0 ? '#d97706' : undefined} />
        <Tile label="Negative"     value={negative}   accent={negative   > 0 ? '#7c3aed' : undefined} />
        <Tile label="Total value"  value={`€${eur(totalValue)}`} />
      </div>

      {/* ── Table ──────────────────────────────────────────────────────── */}
      {rows.length === 0 ? (
        <p style={{ color: '#6b7280', padding: '2rem 0', textAlign: 'center' }}>
          No products match the current filters.
        </p>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
            <thead style={{ background: '#f9fafb' }}>
              <tr>
                <th style={th}>Product</th>
                <th style={th}>Category</th>
                <th style={{ ...th, textAlign: 'right' }}>On Hand</th>
                <th style={{ ...th, textAlign: 'right' }}>Latest Cost</th>
                <th style={{ ...th, textAlign: 'right' }}>WAC</th>
                <th style={{ ...th, textAlign: 'right' }}>Stock Value</th>
                <th style={th}>Preferred Supplier</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.product_id}
                  style={{ background: row.is_active ? 'white' : '#fafafa' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f0f9ff')}
                  onMouseLeave={e => (e.currentTarget.style.background = row.is_active ? 'white' : '#fafafa')}
                >
                  {/* Product name */}
                  <td style={td}>
                    <button
                      onClick={() => navigate(`/inventory/${row.product_id}`)}
                      style={{
                        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                        color: '#1d4ed8', fontWeight: 600, fontSize: '.85rem', textAlign: 'left',
                      }}
                    >
                      {row.product_name}
                    </button>
                    {row.missing_cost        && <Warn title="Missing cost data" />}
                    {row.missing_conversion  && <Warn title="Missing unit conversion" />}
                    {row.has_pending_receipt && <Warn title="Pending receipt — no invoice linked" />}
                    {!row.is_active          && (
                      <span style={{ marginLeft: 6, fontSize: '.7rem', color: '#9ca3af' }}>(inactive)</span>
                    )}
                  </td>

                  <td style={td}>{row.category ?? <span style={{ color: '#9ca3af' }}>—</span>}</td>

                  {/* On Hand */}
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600,
                    color: row.on_hand_qty < 0 ? '#7c3aed' : row.on_hand_qty === 0 ? '#dc2626' : '#111827',
                  }}>
                    {qty(row.on_hand_qty, row.unit)}
                  </td>

                  {/* Latest Cost */}
                  <td style={{ ...td, textAlign: 'right' }}>
                    {row.latest_cost != null ? `€${eur(row.latest_cost)}` : <span style={{ color: '#9ca3af' }}>—</span>}
                  </td>

                  {/* WAC */}
                  <td style={{ ...td, textAlign: 'right' }}>
                    {row.weighted_avg_cost != null ? `€${eur(row.weighted_avg_cost)}` : <span style={{ color: '#9ca3af' }}>—</span>}
                  </td>

                  {/* Stock Value */}
                  <td style={{ ...td, textAlign: 'right', fontWeight: 500 }}>
                    {row.stock_value > 0 ? `€${eur(row.stock_value)}` : <span style={{ color: '#9ca3af' }}>—</span>}
                  </td>

                  <td style={td}>
                    {row.preferred_supplier ?? <span style={{ color: '#9ca3af' }}>—</span>}
                  </td>

                  <td style={td}>
                    <StatusBadge status={row.stock_status} />
                  </td>

                  <td style={{ ...td, textAlign: 'center' }}>
                    <ActionBtn label="Open" onClick={() => navigate(`/inventory/${row.product_id}`)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Locations panel ────────────────────────────────────────────── */}
      {showLocations && (
        <>
          <div
            onClick={() => { setShowLocations(false); setEditingId(null); setLocError(null) }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.3)', zIndex: 50 }}
          />
          <div style={{
            position: 'fixed', top: 0, right: 0, width: 400, height: '100vh',
            background: 'white', zIndex: 60, boxShadow: '-4px 0 24px rgba(0,0,0,.12)',
            padding: '1.5rem', overflowY: 'auto',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Manage Locations</h2>
              <button
                onClick={() => { setShowLocations(false); setEditingId(null); setLocError(null) }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: '#6b7280' }}
              >
                ×
              </button>
            </div>

            {/* Existing locations */}
            <div style={{ marginBottom: '1.5rem' }}>
              {(locations ?? []).map((loc: StockLocation) => (
                <div key={loc.id} style={{
                  border: '1px solid #e5e7eb', borderRadius: 6, padding: '.75rem',
                  marginBottom: '.5rem', background: loc.is_active ? 'white' : '#f9fafb',
                }}>
                  {editingId === loc.id ? (
                    <div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr .45fr', gap: '.5rem', marginBottom: '.5rem' }}>
                        <div>
                          <label style={{ fontSize: '.75rem', fontWeight: 600, color: '#6b7280', display: 'block', marginBottom: '.2rem' }}>Name</label>
                          <input
                            value={editName}
                            onChange={e => setEditName(e.target.value)}
                            style={{ width: '100%', padding: '.35rem .5rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.85rem', boxSizing: 'border-box' }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '.75rem', fontWeight: 600, color: '#6b7280', display: 'block', marginBottom: '.2rem' }}>Order</label>
                          <input
                            type="number"
                            value={editSort}
                            onChange={e => setEditSort(Number(e.target.value))}
                            style={{ width: '100%', padding: '.35rem .5rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.85rem', boxSizing: 'border-box' }}
                          />
                        </div>
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.82rem', marginBottom: '.6rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={editActive === 1}
                          onChange={e => setEditActive(e.target.checked ? 1 : 0)}
                        />
                        Active
                      </label>
                      <div style={{ display: 'flex', gap: '.4rem' }}>
                        <button
                          onClick={() => handleSaveLocation(loc.id)}
                          disabled={doSaveLocation.loading}
                          style={{ flex: 1, padding: '.35rem', background: '#111827', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '.82rem', fontWeight: 600 }}
                        >
                          {doSaveLocation.loading ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          onClick={() => { setEditingId(null); setLocError(null) }}
                          style={{ flex: 1, padding: '.35rem', background: 'white', color: '#374151', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: '.82rem' }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <span style={{ fontWeight: 600, fontSize: '.9rem', color: loc.is_active ? '#111827' : '#9ca3af' }}>
                          {loc.name}
                        </span>
                        <span style={{ marginLeft: '.5rem', fontSize: '.75rem', color: '#9ca3af' }}>
                          order: {loc.sort_order}
                        </span>
                        {!loc.is_active && (
                          <span style={{ marginLeft: '.4rem', fontSize: '.72rem', color: '#9ca3af' }}>(inactive)</span>
                        )}
                      </div>
                      <button
                        onClick={() => startEdit(loc)}
                        style={{ padding: '.2rem .5rem', fontSize: '.75rem', background: 'white', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', color: '#374151' }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'white')}
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Add new location */}
            <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '1rem' }}>
              <h3 style={{ margin: '0 0 .75rem', fontSize: '.9rem', fontWeight: 700, color: '#374151' }}>
                Add Location
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr .45fr', gap: '.5rem', marginBottom: '.5rem' }}>
                <div>
                  <label style={{ fontSize: '.75rem', fontWeight: 600, color: '#6b7280', display: 'block', marginBottom: '.2rem' }}>Name *</label>
                  <input
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    placeholder="e.g. Bar, Cellar…"
                    onKeyDown={e => e.key === 'Enter' && handleAddLocation()}
                    style={{ width: '100%', padding: '.35rem .5rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.85rem', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '.75rem', fontWeight: 600, color: '#6b7280', display: 'block', marginBottom: '.2rem' }}>Order</label>
                  <input
                    type="number"
                    value={newSort}
                    onChange={e => setNewSort(Number(e.target.value))}
                    style={{ width: '100%', padding: '.35rem .5rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.85rem', boxSizing: 'border-box' }}
                  />
                </div>
              </div>
              {locError && (
                <p style={{ color: '#dc2626', fontSize: '.8rem', margin: '.4rem 0' }}>{locError}</p>
              )}
              <button
                onClick={handleAddLocation}
                disabled={doAddLocation.loading || !newName.trim()}
                style={{
                  width: '100%', padding: '.45rem', background: '#111827', color: 'white',
                  border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '.85rem', fontWeight: 600,
                }}
              >
                {doAddLocation.loading ? 'Adding…' : '+ Add Location'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
