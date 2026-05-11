import { useState } from 'react'
import {
  listTransfers, createTransfer, getTransfer,
  confirmTransfer, cancelTransfer,
  getStockLocations, getInventoryOverview, getAllProducts,
} from '@/api/client'
import { useQuery }    from '@/hooks/useAsync'
import { useMutation } from '@/hooks/useMutation'
import Spinner from '@/components/Spinner'
import type { TransferOut, TransferDetail, StockLocation, InventoryOverviewItem, ProductPickerItem } from '@/types/api'

const STATUS_CFG = {
  draft:     { label: 'Draft',     bg: '#fef3c7', color: '#92400e' },
  confirmed: { label: 'Confirmed', bg: '#d1fae5', color: '#065f46' },
  cancelled: { label: 'Cancelled', bg: '#f3f4f6', color: '#6b7280' },
} as const

function StatusBadge({ status }: { status: TransferOut['status'] }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.draft
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

function Tile({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div style={{
      flex: 1, minWidth: 120, padding: '.75rem 1rem',
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

type LineForm = { product_id: number | ''; quantity: string; notes: string }

const emptyLine = (): LineForm => ({ product_id: '', quantity: '', notes: '' })

export default function Transfers() {
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [showCreate, setShowCreate]     = useState(false)
  const [detail, setDetail]             = useState<TransferDetail | null>(null)

  // Create form state
  const [fromLocId, setFromLocId] = useState<number | ''>('')
  const [toLocId,   setToLocId]   = useState<number | ''>('')
  const [formNotes, setFormNotes] = useState('')
  const [lines, setLines]         = useState<LineForm[]>([emptyLine()])
  const [createError, setCreateError] = useState<string | null>(null)

  // Detail panel action errors
  const [actionError, setActionError] = useState<string | null>(null)

  const th: React.CSSProperties = {
    padding: '.5rem .75rem', textAlign: 'left', fontSize: '.72rem',
    fontWeight: 700, color: '#6b7280', textTransform: 'uppercase',
    letterSpacing: '.05em', borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap',
  }
  const td: React.CSSProperties = {
    padding: '.55rem .75rem', fontSize: '.85rem', color: '#374151',
    borderBottom: '1px solid #f3f4f6', verticalAlign: 'middle',
  }

  const { data, loading, error, reload } = useQuery(
    () => listTransfers({ status: statusFilter || undefined }),
    [statusFilter],
  )
  const { data: locations }              = useQuery(getStockLocations)
  const { data: allProducts }            = useQuery(getAllProducts)

  const { data: fromInventory } = useQuery(
    () => fromLocId ? getInventoryOverview({ location_id: fromLocId }) : Promise.resolve([]),
    [fromLocId],
  )

  const availableQty = (productId: number): number => {
    const item = (fromInventory as InventoryOverviewItem[] | undefined)?.find(i => i.product_id === productId)
    return item?.on_hand_qty ?? 0
  }

  const doCreate = useMutation(async () => {
    if (!fromLocId) throw new Error('Select a source location')
    if (!toLocId)   throw new Error('Select a destination location')
    if (fromLocId === toLocId) throw new Error('Source and destination must differ')

    const validLines = lines.filter(l => l.product_id !== '' && l.quantity !== '')
    if (!validLines.length) throw new Error('Add at least one product line')
    for (const l of validLines) {
      if (Number(l.quantity) <= 0) throw new Error('All quantities must be positive')
    }

    await createTransfer({
      from_location_id: fromLocId as number,
      to_location_id:   toLocId as number,
      notes: formNotes || null,
      lines: validLines.map(l => ({
        product_id: l.product_id as number,
        quantity:   Number(l.quantity),
        notes:      l.notes || null,
      })),
    })
    setShowCreate(false)
    resetCreateForm()
    reload()
  })

  const resetCreateForm = () => {
    setFromLocId('')
    setToLocId('')
    setFormNotes('')
    setLines([emptyLine()])
  }

  const handleCreate = async () => {
    setCreateError(null)
    try {
      await doCreate.mutate(undefined)
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create transfer')
    }
  }

  const openDetail = async (id: number) => {
    setActionError(null)
    const t = await getTransfer(id)
    setDetail(t)
  }

  const doConfirm = useMutation(async (id: number) => {
    const t = await confirmTransfer(id)
    setDetail(t)
    reload()
  })

  const doCancel = useMutation(async (id: number) => {
    const t = await cancelTransfer(id)
    setDetail(t)
    reload()
  })

  const handleConfirm = async (id: number) => {
    setActionError(null)
    try {
      await doConfirm.mutate(id)
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Failed to confirm transfer')
    }
  }

  const handleCancel = async (id: number) => {
    setActionError(null)
    try {
      await doCancel.mutate(id)
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Failed to cancel transfer')
    }
  }

  const updateLine = (i: number, key: keyof LineForm, value: string | number) =>
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [key]: value } : l))

  const removeLine = (i: number) =>
    setLines(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev)

  if (loading && !data) return <Spinner />
  if (error) return <p style={{ color: '#dc2626' }}>{error}</p>

  const transfers = data?.transfers ?? []
  const draft     = transfers.filter(t => t.status === 'draft').length
  const confirmed = transfers.filter(t => t.status === 'confirmed').length
  const cancelled = transfers.filter(t => t.status === 'cancelled').length

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '.45rem .6rem', border: '1px solid #d1d5db',
    borderRadius: 6, fontSize: '.85rem', boxSizing: 'border-box',
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700, color: '#111827' }}>
            Transfers
          </h1>
          <p style={{ margin: '.2rem 0 0', color: '#6b7280', fontSize: '.85rem' }}>
            Move stock between storage locations
          </p>
        </div>
        <button
          onClick={() => { setShowCreate(true); setCreateError(null) }}
          style={{
            padding: '.5rem 1rem', background: '#111827', color: 'white',
            border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '.85rem', fontWeight: 600,
          }}
        >
          + New Transfer
        </button>
      </div>

      {/* Summary tiles */}
      <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <Tile label="Total"     value={transfers.length} />
        <Tile label="Draft"     value={draft}     accent={draft     > 0 ? '#92400e' : undefined} />
        <Tile label="Confirmed" value={confirmed} accent={confirmed > 0 ? '#065f46' : undefined} />
        <Tile label="Cancelled" value={cancelled} />
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: '.75rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          style={{ padding: '.4rem .6rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '.85rem' }}
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="confirmed">Confirmed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {/* Table */}
      {transfers.length === 0 ? (
        <p style={{ color: '#6b7280', padding: '2rem 0', textAlign: 'center' }}>
          No transfers yet. Create one to move stock between locations.
        </p>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
            <thead style={{ background: '#f9fafb' }}>
              <tr>
                <th style={th}>Reference</th>
                <th style={th}>From</th>
                <th style={th}>To</th>
                <th style={{ ...th, textAlign: 'right' }}>Lines</th>
                <th style={th}>Date</th>
                <th style={th}>Status</th>
                <th style={th}>Notes</th>
                <th style={{ ...th, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map(t => (
                <tr
                  key={t.id}
                  style={{ background: 'white' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f0f9ff')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'white')}
                >
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: '.8rem', color: '#6b7280' }}>
                    {t.reference_number}
                  </td>
                  <td style={{ ...td, fontWeight: 600 }}>{t.from_location_name}</td>
                  <td style={td}>{t.to_location_name}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{t.line_count}</td>
                  <td style={td}>{t.created_at.slice(0, 10)}</td>
                  <td style={td}><StatusBadge status={t.status} /></td>
                  <td style={{ ...td, color: '#6b7280', maxWidth: 180 }}>
                    {t.notes ?? <span style={{ color: '#9ca3af' }}>—</span>}
                  </td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    <button
                      onClick={() => openDetail(t.id)}
                      style={{
                        padding: '.2rem .5rem', fontSize: '.72rem', cursor: 'pointer',
                        background: 'white', border: '1px solid #d1d5db', borderRadius: 4,
                        color: '#374151', fontWeight: 500,
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'white')}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Detail panel ─────────────────────────────────────────────────── */}
      {detail && (
        <>
          <div
            onClick={() => setDetail(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.3)', zIndex: 50 }}
          />
          <div style={{
            position: 'fixed', top: 0, right: 0, width: 540, height: '100vh',
            background: 'white', zIndex: 60, boxShadow: '-4px 0 24px rgba(0,0,0,.12)',
            padding: '1.5rem', overflowY: 'auto',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>
                  {detail.reference_number}
                </h2>
                <p style={{ margin: '.2rem 0 0', fontSize: '.82rem', color: '#6b7280' }}>
                  {detail.from_location_name} → {detail.to_location_name}
                </p>
              </div>
              <button
                onClick={() => setDetail(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: '#6b7280' }}
              >
                ×
              </button>
            </div>

            {/* Meta grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.5rem', marginBottom: '1.25rem' }}>
              {[
                ['Status',   <StatusBadge status={detail.status} key="s" />],
                ['Created',  detail.created_at.slice(0, 16).replace('T', ' ')],
                ['Confirmed', detail.confirmed_at ? detail.confirmed_at.slice(0, 16).replace('T', ' ') : '—'],
                ['Cancelled', detail.cancelled_at ? detail.cancelled_at.slice(0, 16).replace('T', ' ') : '—'],
              ].map(([label, value]) => (
                <div key={String(label)} style={{ padding: '.6rem .75rem', background: '#f9fafb', borderRadius: 6 }}>
                  <div style={{ fontSize: '.72rem', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                    {label}
                  </div>
                  <div style={{ marginTop: 2, fontSize: '.85rem', color: '#374151' }}>{value}</div>
                </div>
              ))}
            </div>

            {detail.notes && (
              <p style={{ fontSize: '.85rem', color: '#6b7280', background: '#f9fafb', borderRadius: 6, padding: '.6rem .75rem', marginBottom: '1.25rem' }}>
                {detail.notes}
              </p>
            )}

            {/* Lines table */}
            <h3 style={{ fontSize: '.9rem', fontWeight: 700, color: '#374151', margin: '0 0 .5rem' }}>
              Items ({detail.lines.length})
            </h3>
            <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 6, marginBottom: '1.25rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.82rem' }}>
                <thead style={{ background: '#f9fafb' }}>
                  <tr>
                    <th style={{ ...th, fontSize: '.7rem' }}>Product</th>
                    <th style={{ ...th, fontSize: '.7rem', textAlign: 'right' }}>Available</th>
                    <th style={{ ...th, fontSize: '.7rem', textAlign: 'right' }}>Transfer Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lines.map(ln => {
                    const tight = ln.available_qty < ln.quantity
                    return (
                      <tr key={ln.id}>
                        <td style={{ ...td, fontSize: '.82rem' }}>{ln.product_name}</td>
                        <td style={{ ...td, textAlign: 'right', color: tight ? '#dc2626' : '#374151', fontWeight: tight ? 600 : undefined }}>
                          {ln.available_qty} {ln.unit}
                        </td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>
                          {ln.quantity} {ln.unit}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {actionError && (
              <p style={{ color: '#dc2626', fontSize: '.82rem', marginBottom: '.75rem' }}>{actionError}</p>
            )}

            {detail.status === 'draft' && (
              <div style={{ display: 'flex', gap: '.75rem' }}>
                <button
                  onClick={() => handleConfirm(detail.id)}
                  disabled={doConfirm.loading}
                  style={{
                    flex: 1, padding: '.6rem', background: '#059669', color: 'white',
                    border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: '.9rem',
                  }}
                >
                  {doConfirm.loading ? 'Confirming…' : 'Confirm Transfer'}
                </button>
                <button
                  onClick={() => handleCancel(detail.id)}
                  disabled={doCancel.loading}
                  style={{
                    flex: 1, padding: '.6rem', background: 'white', color: '#374151',
                    border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: '.9rem',
                  }}
                >
                  {doCancel.loading ? 'Cancelling…' : 'Cancel Transfer'}
                </button>
              </div>
            )}

            {detail.status === 'confirmed' && (
              <p style={{ fontSize: '.82rem', color: '#059669', fontWeight: 600, textAlign: 'center', padding: '.75rem', background: '#d1fae5', borderRadius: 6 }}>
                Stock movements have been recorded for this transfer.
              </p>
            )}
            {detail.status === 'cancelled' && (
              <p style={{ fontSize: '.82rem', color: '#6b7280', textAlign: 'center', padding: '.75rem', background: '#f3f4f6', borderRadius: 6 }}>
                This transfer was cancelled. No stock was moved.
              </p>
            )}
          </div>
        </>
      )}

      {/* ── Create panel ─────────────────────────────────────────────────── */}
      {showCreate && (
        <>
          <div
            onClick={() => { setShowCreate(false); resetCreateForm() }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.3)', zIndex: 50 }}
          />
          <div style={{
            position: 'fixed', top: 0, right: 0, width: 500, height: '100vh',
            background: 'white', zIndex: 60, boxShadow: '-4px 0 24px rgba(0,0,0,.12)',
            padding: '1.5rem', overflowY: 'auto',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>New Transfer</h2>
              <button
                onClick={() => { setShowCreate(false); resetCreateForm() }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: '#6b7280' }}
              >
                ×
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem', marginBottom: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '.85rem', fontWeight: 600, color: '#374151', marginBottom: '.35rem' }}>
                  From *
                </label>
                <select
                  value={fromLocId}
                  onChange={e => setFromLocId(e.target.value === '' ? '' : Number(e.target.value))}
                  style={inputStyle}
                >
                  <option value="">Select…</option>
                  {(locations ?? []).map((l: StockLocation) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '.85rem', fontWeight: 600, color: '#374151', marginBottom: '.35rem' }}>
                  To *
                </label>
                <select
                  value={toLocId}
                  onChange={e => setToLocId(e.target.value === '' ? '' : Number(e.target.value))}
                  style={inputStyle}
                >
                  <option value="">Select…</option>
                  {(locations ?? []).filter((l: StockLocation) => l.id !== fromLocId).map((l: StockLocation) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <label style={{ display: 'block', fontSize: '.85rem', fontWeight: 600, color: '#374151', marginBottom: '.35rem' }}>
              Notes
            </label>
            <textarea
              value={formNotes}
              onChange={e => setFormNotes(e.target.value)}
              rows={2}
              placeholder="Optional transfer notes…"
              style={{ ...inputStyle, resize: 'vertical', marginBottom: '1.25rem' }}
            />

            {/* Lines */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.5rem' }}>
              <span style={{ fontSize: '.9rem', fontWeight: 700, color: '#374151' }}>Items</span>
              <button
                onClick={() => setLines(prev => [...prev, emptyLine()])}
                style={{
                  fontSize: '.78rem', padding: '.2rem .55rem', background: '#f3f4f6',
                  border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', color: '#374151',
                }}
              >
                + Add item
              </button>
            </div>

            {lines.map((ln, i) => {
              const avail = ln.product_id !== '' ? availableQty(ln.product_id as number) : null
              return (
                <div
                  key={i}
                  style={{
                    display: 'grid', gridTemplateColumns: '1fr .7fr auto', gap: '.5rem',
                    alignItems: 'start', marginBottom: '.6rem',
                    padding: '.6rem', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6,
                  }}
                >
                  <div>
                    <select
                      value={ln.product_id}
                      onChange={e => updateLine(i, 'product_id', e.target.value === '' ? '' : Number(e.target.value))}
                      style={{ ...inputStyle, marginBottom: 0 }}
                    >
                      <option value="">Select product…</option>
                      {(allProducts ?? []).map((p: ProductPickerItem) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    {avail !== null && fromLocId !== '' && (
                      <div style={{ fontSize: '.73rem', color: '#6b7280', marginTop: '.2rem' }}>
                        Available: {avail} {(allProducts ?? []).find((p: ProductPickerItem) => p.id === ln.product_id)?.unit ?? ''}
                      </div>
                    )}
                  </div>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="Qty"
                    value={ln.quantity}
                    onChange={e => updateLine(i, 'quantity', e.target.value)}
                    style={{ ...inputStyle, marginBottom: 0 }}
                  />
                  <button
                    onClick={() => removeLine(i)}
                    disabled={lines.length === 1}
                    style={{
                      padding: '.4rem .55rem', background: 'none', border: '1px solid #e5e7eb',
                      borderRadius: 4, cursor: lines.length > 1 ? 'pointer' : 'not-allowed',
                      color: '#9ca3af', fontSize: '.9rem', marginTop: 0,
                    }}
                  >
                    ×
                  </button>
                </div>
              )
            })}

            {createError && (
              <p style={{ color: '#dc2626', fontSize: '.82rem', margin: '.75rem 0' }}>{createError}</p>
            )}

            <button
              onClick={handleCreate}
              disabled={doCreate.loading}
              style={{
                width: '100%', padding: '.6rem', background: '#111827', color: 'white',
                border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '.9rem', fontWeight: 600,
                marginTop: '1rem',
              }}
            >
              {doCreate.loading ? 'Creating…' : 'Create Transfer Draft'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
