import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  getProductDetail, getProductMovements, getStockLocations,
  adjustStock, recordWaste, transferStock, setStockThreshold,
} from '@/api/client'
import { useQuery }    from '@/hooks/useAsync'
import { useMutation } from '@/hooks/useMutation'
import Spinner from '@/components/Spinner'
import type { MovementHistoryItem } from '@/types/api'

// ── Formatters ────────────────────────────────────────────────────────────────
const eur = (n: number) =>
  n.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtQty = (n: number, unit: string | null) =>
  `${n % 1 === 0 ? n : n.toFixed(3)} ${unit ?? ''}`
const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('el-GR') : '—'

// ── Status badge ──────────────────────────────────────────────────────────────
const STATUS_CFG = {
  ok:           { label: 'OK',           bg: '#d1fae5', color: '#065f46' },
  low_stock:    { label: 'Low stock',    bg: '#fef3c7', color: '#92400e' },
  out_of_stock: { label: 'Out of stock', bg: '#fee2e2', color: '#991b1b' },
  negative:     { label: 'Negative',     bg: '#f3e8ff', color: '#6b21a8' },
} as const

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status as keyof typeof STATUS_CFG] ?? STATUS_CFG.ok
  return (
    <span style={{
      display: 'inline-block', padding: '.2rem .65rem', borderRadius: 9999,
      fontSize: '.78rem', fontWeight: 700, background: cfg.bg, color: cfg.color,
    }}>
      {cfg.label}
    </span>
  )
}

// ── Movement type labels & colors ─────────────────────────────────────────────
const MT_LABEL: Record<string, string> = {
  purchase_receipt:       'Purchase',
  adjustment_up:          'Adjustment +',
  adjustment_down:        'Adjustment −',
  waste:                  'Waste',
  transfer_out:           'Transfer Out',
  transfer_in:            'Transfer In',
  production_consumption: 'Production (in)',
  production_output:      'Production (out)',
  count_reconciliation:   'Count Reconcile',
  opening:                'Opening Balance',
  return_to_supplier:     'Return to Supplier',
  receipt_pending:        'Pending Receipt',
}
const MT_COLOR: Record<string, string> = {
  purchase_receipt: '#065f46', adjustment_up: '#065f46',
  transfer_in: '#065f46', production_output: '#065f46', opening: '#374151',
  adjustment_down: '#991b1b', waste: '#991b1b',
  transfer_out: '#991b1b', production_consumption: '#991b1b',
  count_reconciliation: '#92400e',
  return_to_supplier: '#991b1b',
  receipt_pending: '#065f46',
}

// ── Shared sub-components ─────────────────────────────────────────────────────
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', marginBottom: '1rem' }}>
      <div style={{ padding: '.6rem 1rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: '.78rem', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '.05em' }}>
        {title}
      </div>
      <div style={{ padding: '1rem' }}>{children}</div>
    </div>
  )
}

function Tile({ label, value, accent, sub }: { label: string; value: string | number; accent?: string; sub?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 130, padding: '.75rem 1rem', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8 }}>
      <div style={{ fontSize: '.7rem', color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: '1.25rem', fontWeight: 700, color: accent ?? '#111827', marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: '.72rem', color: '#9ca3af', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function ActionBtn({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} style={{
      padding: '.4rem .9rem', fontSize: '.82rem', fontWeight: 600, cursor: 'pointer',
      background: danger ? '#fef2f2' : 'white',
      border: `1px solid ${danger ? '#fca5a5' : '#d1d5db'}`,
      borderRadius: 6, color: danger ? '#dc2626' : '#374151',
    }}>
      {label}
    </button>
  )
}

// ── Modal wrapper ─────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 80 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 400, background: 'white', borderRadius: 10, boxShadow: '0 20px 60px rgba(0,0,0,.2)',
        zIndex: 90, padding: '1.5rem',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: '#6b7280' }}>✕</button>
        </div>
        {children}
      </div>
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '.25rem', marginBottom: '.75rem' }}>
      <span style={{ fontSize: '.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.03em' }}>{label}</span>
      {children}
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '.4rem .65rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '.9rem', width: '100%', boxSizing: 'border-box',
}

const submitStyle: React.CSSProperties = {
  width: '100%', padding: '.55rem', background: '#111827', color: 'white',
  border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: '.9rem', marginTop: '.5rem',
}

// ── Main page ─────────────────────────────────────────────────────────────────
type ModalType = 'adjust' | 'waste' | 'transfer' | 'threshold' | null

export default function InventoryDetail() {
  const { productId } = useParams<{ productId: string }>()
  const navigate      = useNavigate()
  const id            = Number(productId)

  const [modal,       setModal]       = useState<ModalType>(null)
  const [mvTypeFilter,setMvTypeFilter]= useState('')
  const [mvOffset,    setMvOffset]    = useState(0)
  const MV_LIMIT = 20

  const { data, loading, error, reload } = useQuery(() => getProductDetail(id), [id])
  const { data: locations }              = useQuery(getStockLocations)
  const { data: mv, reload: reloadMv }   = useQuery(
    () => getProductMovements(id, { movement_type: mvTypeFilter || undefined, limit: MV_LIMIT, offset: mvOffset }),
    [id, mvTypeFilter, mvOffset],
  )

  const reloadAll = async () => { await reload(); await reloadMv() }

  // ── Action mutations ───────────────────────────────────────────────────
  const [adjDir,    setAdjDir]    = useState<'up'|'down'>('up')
  const [adjQty,    setAdjQty]    = useState('')
  const [adjLoc,    setAdjLoc]    = useState('')
  const [adjReason, setAdjReason] = useState('')
  const [adjNotes,  setAdjNotes]  = useState('')
  const doAdjust = useMutation(async () => {
    await adjustStock(id, { location_id: Number(adjLoc), direction: adjDir, quantity: Number(adjQty), reason: adjReason || null, notes: adjNotes || null })
    setModal(null); setAdjQty(''); setAdjReason(''); setAdjNotes('')
    await reloadAll()
  })

  const [wstQty,    setWstQty]    = useState('')
  const [wstLoc,    setWstLoc]    = useState('')
  const [wstReason, setWstReason] = useState('')
  const [wstNotes,  setWstNotes]  = useState('')
  const doWaste = useMutation(async () => {
    await recordWaste(id, { location_id: Number(wstLoc), quantity: Number(wstQty), reason: wstReason || null, notes: wstNotes || null })
    setModal(null); setWstQty(''); setWstReason(''); setWstNotes('')
    await reloadAll()
  })

  const [trFrom,  setTrFrom]  = useState('')
  const [trTo,    setTrTo]    = useState('')
  const [trQty,   setTrQty]   = useState('')
  const [trNotes, setTrNotes] = useState('')
  const doTransfer = useMutation(async () => {
    await transferStock(id, { from_location_id: Number(trFrom), to_location_id: Number(trTo), quantity: Number(trQty), notes: trNotes || null })
    setModal(null); setTrQty(''); setTrNotes('')
    await reloadAll()
  })

  const [thrVal, setThrVal] = useState('')
  const doThreshold = useMutation(async () => {
    const val = thrVal.trim() === '' ? null : Number(thrVal)
    await setStockThreshold(id, val)
    setModal(null)
    await reload()
  })

  // ── Open modal helpers ─────────────────────────────────────────────────
  const openAdjust = () => {
    if (data?.balances[0]) setAdjLoc(String(data.balances[0].location_id))
    setModal('adjust')
  }
  const openWaste = () => {
    if (data?.balances[0]) setWstLoc(String(data.balances[0].location_id))
    setModal('waste')
  }
  const openTransfer = () => {
    const locs = locations ?? []
    if (locs[0]) setTrFrom(String(locs[0].id))
    if (locs[1]) setTrTo(String(locs[1].id))
    setModal('transfer')
  }
  const openThreshold = () => {
    setThrVal(data?.min_stock_level != null ? String(data.min_stock_level) : '')
    setModal('threshold')
  }

  if (loading && !data) return <Spinner />
  if (error)            return <p style={{ color: '#dc2626' }}>{error}</p>
  if (!data)            return null

  const locs     = locations ?? []
  const cost     = data.cost
  const statusCfg = STATUS_CFG[data.stock_status as keyof typeof STATUS_CFG] ?? STATUS_CFG.ok

  // ── Table cell styles ──────────────────────────────────────────────────
  const th: React.CSSProperties = { padding: '.45rem .75rem', fontSize: '.72rem', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '2px solid #e5e7eb', textAlign: 'left', whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '.5rem .75rem', fontSize: '.84rem', borderBottom: '1px solid #f3f4f6', color: '#374151', verticalAlign: 'middle' }

  const MvRow = ({ m }: { m: MovementHistoryItem }) => {
    const isPos = m.quantity > 0
    return (
      <tr>
        <td style={td}><span style={{ fontSize: '.75rem', color: '#6b7280' }}>{new Date(m.moved_at).toLocaleDateString('el-GR')}</span></td>
        <td style={td}>
          <span style={{ fontSize: '.78rem', fontWeight: 600, color: MT_COLOR[m.movement_type] ?? '#374151' }}>
            {MT_LABEL[m.movement_type] ?? m.movement_type}
          </span>
        </td>
        <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: isPos ? '#065f46' : '#dc2626' }}>
          {isPos ? '+' : ''}{fmtQty(m.quantity, m.unit)}
        </td>
        <td style={td}>{m.location_name}</td>
        <td style={td}>
          {m.reason && <span style={{ color: '#6b7280', fontSize: '.78rem' }}>{m.reason}</span>}
          {m.invoice_number && (
            <Link to={`/invoices`} style={{ fontSize: '.78rem', color: '#1d4ed8' }}>
              {m.invoice_number}
            </Link>
          )}
        </td>
      </tr>
    )
  }

  return (
    <div>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: '1.25rem' }}>
        <button onClick={() => navigate('/inventory')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: '.85rem', padding: 0, marginBottom: '.5rem' }}>
          ← Inventory Overview
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, color: '#111827' }}>{data.name}</h1>
          <StatusBadge status={data.stock_status} />
          <Link
            to={`/products?open=${id}`}
            style={{
              fontSize: '.78rem', color: '#4f46e5', textDecoration: 'none',
              background: '#eef2ff', padding: '.2rem .6rem', borderRadius: 4,
              fontWeight: 500, border: '1px solid #c7d2fe',
            }}
          >
            View product details →
          </Link>
          {data.missing_cost && (
            <span style={{ fontSize: '.75rem', background: '#fef3c7', color: '#92400e', padding: '.15rem .5rem', borderRadius: 9999, fontWeight: 600 }}>
              Missing cost data
            </span>
          )}
          {!data.is_active && (
            <span style={{ fontSize: '.75rem', background: '#f3f4f6', color: '#6b7280', padding: '.15rem .5rem', borderRadius: 9999 }}>Inactive</span>
          )}
        </div>
        {data.category && <div style={{ color: '#6b7280', fontSize: '.85rem', marginTop: '.25rem' }}>{data.category}</div>}
      </div>

      {/* ── Action bar ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <ActionBtn label="Adjust Stock"     onClick={openAdjust} />
        <ActionBtn label="Record Waste"     onClick={openWaste} danger />
        <ActionBtn label="Transfer"         onClick={openTransfer} />
        <ActionBtn label="Set Threshold"    onClick={openThreshold} />
      </div>

      {/* ── Summary tiles ───────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        <Tile
          label="Total On Hand"
          value={fmtQty(data.total_on_hand, data.unit)}
          accent={statusCfg.color}
          sub={
            data.units_per_pack && data.pack_unit
              ? `${fmtQty(data.total_on_hand / data.units_per_pack, data.pack_unit)}`
              : undefined
          }
        />
        <Tile label="Stock Value"      value={`€${eur(data.stock_value)}`} />
        <Tile label="Last Purchase"    value={cost.last_purchase_cost != null ? `€${eur(cost.last_purchase_cost)}` : '—'} sub={fmtDate(cost.last_purchase_date)} />
        <Tile label="Avg Cost (WAC)"   value={cost.average_cost != null ? `€${eur(cost.average_cost)}` : '—'} />
        <Tile
          label="Min Stock Level"
          value={data.min_stock_level != null ? fmtQty(data.min_stock_level, data.unit) : 'Not set'}
          accent={data.min_stock_level != null ? '#374151' : '#9ca3af'}
        />
      </div>

      {/* ── Two-column grid ─────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '1.25rem', alignItems: 'start' }}>

        {/* LEFT: By Location + Movement History */}
        <div>
          {/* By Location */}
          <Card title="Stock by Location">
            {data.balances.length === 0 ? (
              <p style={{ color: '#9ca3af', margin: 0, fontSize: '.85rem' }}>No stock recorded yet.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={th}>Location</th>
                  <th style={{ ...th, textAlign: 'right' }}>Quantity</th>
                </tr></thead>
                <tbody>
                  {data.balances.map(b => (
                    <tr key={b.location_id}>
                      <td style={td}>{b.location_name}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: b.quantity < 0 ? '#7c3aed' : b.quantity === 0 ? '#dc2626' : '#111827' }}>
                        {fmtQty(b.quantity, b.unit ?? data.unit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          {/* Movement History */}
          <Card title={`Movement History${mv ? ` (${mv.total})` : ''}`}>
            <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.75rem', alignItems: 'center' }}>
              <select
                value={mvTypeFilter}
                onChange={e => { setMvTypeFilter(e.target.value); setMvOffset(0) }}
                style={{ padding: '.3rem .55rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '.82rem' }}
              >
                <option value="">All types</option>
                {Object.entries(MT_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <span style={{ fontSize: '.78rem', color: '#9ca3af', marginLeft: 'auto' }}>
                {mv && `${mvOffset + 1}–${Math.min(mvOffset + MV_LIMIT, mv.total)} of ${mv.total}`}
              </span>
            </div>

            {!mv ? <Spinner /> : mv.movements.length === 0 ? (
              <p style={{ color: '#9ca3af', margin: 0, fontSize: '.85rem' }}>No movements found.</p>
            ) : (
              <>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>
                      <th style={th}>Date</th>
                      <th style={th}>Type</th>
                      <th style={{ ...th, textAlign: 'right' }}>Qty</th>
                      <th style={th}>Location</th>
                      <th style={th}>Note / Invoice</th>
                    </tr></thead>
                    <tbody>
                      {mv.movements.map(m => <MvRow key={m.id} m={m} />)}
                    </tbody>
                  </table>
                </div>
                {mv.total > MV_LIMIT && (
                  <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end', marginTop: '.75rem' }}>
                    <button disabled={mvOffset === 0} onClick={() => setMvOffset(o => Math.max(0, o - MV_LIMIT))}
                      style={{ padding: '.3rem .7rem', border: '1px solid #d1d5db', borderRadius: 5, cursor: 'pointer', background: 'white', fontSize: '.82rem' }}>
                      ← Prev
                    </button>
                    <button disabled={mvOffset + MV_LIMIT >= mv.total} onClick={() => setMvOffset(o => o + MV_LIMIT)}
                      style={{ padding: '.3rem .7rem', border: '1px solid #d1d5db', borderRadius: 5, cursor: 'pointer', background: 'white', fontSize: '.82rem' }}>
                      Next →
                    </button>
                  </div>
                )}
              </>
            )}
          </Card>
        </div>

        {/* RIGHT: Cost Metrics + Suppliers + Recipes */}
        <div>
          {/* Cost Metrics */}
          <Card title="Cost Metrics">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.84rem' }}>
              <tbody>
                {([
                  ['Last purchase', cost.last_purchase_cost != null ? `€${eur(cost.last_purchase_cost)}` : '—'],
                  ['Last purchase date', fmtDate(cost.last_purchase_date)],
                  ['Weighted avg cost', cost.average_cost != null ? `€${eur(cost.average_cost)}` : '—'],
                  ['Min cost (90 days)', cost.min_cost_90d != null ? `€${eur(cost.min_cost_90d)}` : '—'],
                  ['Max cost (90 days)', cost.max_cost_90d != null ? `€${eur(cost.max_cost_90d)}` : '—'],
                  ['Total qty purchased', cost.total_purchased > 0 ? fmtQty(cost.total_purchased, data.pack_unit ?? data.unit) : '—'],
                ] as [string, string][]).map(([label, value]) => (
                  <tr key={label} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '.4rem .25rem', color: '#6b7280', width: '55%' }}>{label}</td>
                    <td style={{ padding: '.4rem .25rem', fontWeight: 500 }}>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Suppliers */}
          <Card title="Suppliers">
            {data.suppliers.length === 0 ? (
              <p style={{ color: '#9ca3af', margin: 0, fontSize: '.85rem' }}>No suppliers linked.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
                {data.suppliers.map(s => (
                  <div key={s.supplier_product_id} style={{ padding: '.65rem', border: '1px solid #e5e7eb', borderRadius: 6, background: s.is_preferred ? '#f0fdf4' : 'white' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ fontWeight: 700, fontSize: '.88rem', color: '#111827' }}>
                        {s.supplier_name}
                        {s.is_preferred === 1 && <span style={{ marginLeft: 6, fontSize: '.7rem', color: '#065f46', background: '#d1fae5', padding: '.1rem .4rem', borderRadius: 9999 }}>Preferred</span>}
                      </div>
                      {s.current_price != null && (
                        <span style={{ fontWeight: 700, color: '#111827', fontSize: '.9rem' }}>€{eur(s.current_price)}</span>
                      )}
                    </div>
                    <div style={{ fontSize: '.78rem', color: '#6b7280', marginTop: '.25rem' }}>
                      {s.supplier_sku && <span>SKU: {s.supplier_sku} · </span>}
                      {s.total_ordered > 0 && <span>Ordered: {fmtQty(s.total_ordered, data.unit)} · </span>}
                      <span>Last: {fmtDate(s.last_invoice_date)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Recipes */}
          <Card title="Used in Recipes">
            {data.recipes.length === 0 ? (
              <p style={{ color: '#9ca3af', margin: 0, fontSize: '.85rem' }}>Not used in any recipe.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
                {data.recipes.map(r => (
                  <div key={r.recipe_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.5rem .65rem', border: '1px solid #e5e7eb', borderRadius: 6 }}>
                    <div>
                      <Link to="/recipes" style={{ fontWeight: 600, fontSize: '.88rem', color: '#1d4ed8', textDecoration: 'none' }}>
                        {r.recipe_name}
                      </Link>
                      <div style={{ fontSize: '.75rem', color: '#6b7280', marginTop: 2 }}>
                        Needs {fmtQty(r.quantity_needed, r.unit)} · Can make: <strong>{r.can_produce}</strong>
                      </div>
                    </div>
                    {r.selling_price != null && (
                      <span style={{ fontSize: '.82rem', color: '#374151', fontWeight: 600 }}>€{eur(r.selling_price)}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ── Modals ───────────────────────────────────────────────────────── */}

      {modal === 'adjust' && (
        <Modal title="Adjust Stock" onClose={() => setModal(null)}>
          <Field label="Location">
            <select value={adjLoc} onChange={e => setAdjLoc(e.target.value)} style={inputStyle}>
              {locs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          <Field label="Direction">
            <select value={adjDir} onChange={e => setAdjDir(e.target.value as 'up' | 'down')} style={inputStyle}>
              <option value="up">Add stock (+)</option>
              <option value="down">Remove stock (−)</option>
            </select>
          </Field>
          <Field label={`Quantity (${data.unit ?? 'units'})`}>
            <input type="number" min="0.001" step="any" value={adjQty} onChange={e => setAdjQty(e.target.value)} style={inputStyle} placeholder="e.g. 5" />
          </Field>
          <Field label="Reason">
            <input type="text" value={adjReason} onChange={e => setAdjReason(e.target.value)} style={inputStyle} placeholder="e.g. Counting error" />
          </Field>
          <Field label="Notes">
            <input type="text" value={adjNotes} onChange={e => setAdjNotes(e.target.value)} style={inputStyle} />
          </Field>
          {doAdjust.error && <p style={{ color: '#dc2626', fontSize: '.82rem', margin: '0 0 .5rem' }}>{doAdjust.error}</p>}
          <button onClick={() => doAdjust.mutate(undefined)} disabled={doAdjust.loading || !adjQty || !adjLoc} style={submitStyle}>
            {doAdjust.loading ? 'Saving…' : 'Apply Adjustment'}
          </button>
        </Modal>
      )}

      {modal === 'waste' && (
        <Modal title="Record Waste" onClose={() => setModal(null)}>
          <Field label="Location">
            <select value={wstLoc} onChange={e => setWstLoc(e.target.value)} style={inputStyle}>
              {locs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          <Field label={`Quantity wasted (${data.unit ?? 'units'})`}>
            <input type="number" min="0.001" step="any" value={wstQty} onChange={e => setWstQty(e.target.value)} style={inputStyle} placeholder="e.g. 1" />
          </Field>
          <Field label="Reason">
            <input type="text" value={wstReason} onChange={e => setWstReason(e.target.value)} style={inputStyle} placeholder="e.g. Expired, Spilled" />
          </Field>
          <Field label="Notes">
            <input type="text" value={wstNotes} onChange={e => setWstNotes(e.target.value)} style={inputStyle} />
          </Field>
          {doWaste.error && <p style={{ color: '#dc2626', fontSize: '.82rem', margin: '0 0 .5rem' }}>{doWaste.error}</p>}
          <button onClick={() => doWaste.mutate(undefined)} disabled={doWaste.loading || !wstQty || !wstLoc} style={{ ...submitStyle, background: '#dc2626' }}>
            {doWaste.loading ? 'Saving…' : 'Record Waste'}
          </button>
        </Modal>
      )}

      {modal === 'transfer' && (
        <Modal title="Transfer Stock" onClose={() => setModal(null)}>
          <Field label="From location">
            <select value={trFrom} onChange={e => setTrFrom(e.target.value)} style={inputStyle}>
              {locs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          <Field label="To location">
            <select value={trTo} onChange={e => setTrTo(e.target.value)} style={inputStyle}>
              {locs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          <Field label={`Quantity (${data.unit ?? 'units'})`}>
            <input type="number" min="0.001" step="any" value={trQty} onChange={e => setTrQty(e.target.value)} style={inputStyle} placeholder="e.g. 3" />
          </Field>
          <Field label="Notes">
            <input type="text" value={trNotes} onChange={e => setTrNotes(e.target.value)} style={inputStyle} />
          </Field>
          {doTransfer.error && <p style={{ color: '#dc2626', fontSize: '.82rem', margin: '0 0 .5rem' }}>{doTransfer.error}</p>}
          <button onClick={() => doTransfer.mutate(undefined)} disabled={doTransfer.loading || !trQty || !trFrom || !trTo} style={submitStyle}>
            {doTransfer.loading ? 'Saving…' : 'Transfer'}
          </button>
        </Modal>
      )}

      {modal === 'threshold' && (
        <Modal title="Set Reorder Threshold" onClose={() => setModal(null)}>
          <p style={{ fontSize: '.85rem', color: '#6b7280', margin: '0 0 1rem' }}>
            The product will be flagged as "Low stock" when on-hand drops to or below this value. Leave blank to disable.
          </p>
          <Field label={`Min stock level (${data.unit ?? 'units'})`}>
            <input type="number" min="0" step="any" value={thrVal} onChange={e => setThrVal(e.target.value)} style={inputStyle} placeholder="e.g. 5" />
          </Field>
          {doThreshold.error && <p style={{ color: '#dc2626', fontSize: '.82rem', margin: '0 0 .5rem' }}>{doThreshold.error}</p>}
          <button onClick={() => doThreshold.mutate(undefined)} disabled={doThreshold.loading} style={submitStyle}>
            {doThreshold.loading ? 'Saving…' : 'Save Threshold'}
          </button>
        </Modal>
      )}
    </div>
  )
}
