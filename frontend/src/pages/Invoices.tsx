import { useState } from 'react'
import { getInvoices, getInvoice, deleteInvoice, updateInvoice, getSuppliers, getPendingReceipts, linkReceiptToInvoiceLine } from '@/api/client'
import { useQuery }    from '@/hooks/useAsync'
import { useMutation } from '@/hooks/useMutation'
import Spinner         from '@/components/Spinner'
import type { InvoiceDetail, InvoiceUpdate, PendingReceiptOut } from '@/types/api'

interface EditState {
  invoice_date:   string
  invoice_number: string
  invoice_type:   'invoice' | 'credit_note'
  delivery_date:  string
  notes:          string
}

const eur = (n: number) =>
  n.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const confirmInvoiceDelete = (invoiceNumber: string) =>
  confirm(
    `Delete invoice ${invoiceNumber}?\n\n` +
    'This will remove its lines and linked stock receipts.\n' +
    'Exclusive products may also be removed.\n\n' +
    'This action cannot be undone.'
  )

type SortBy  = 'invoice_date' | 'supplier_name'
type SortDir = 'asc' | 'desc'

export default function Invoices() {
  const [supplierId, setSupplierId] = useState<number | ''>('')
  const [dateFrom,   setDateFrom]   = useState('')
  const [dateTo,     setDateTo]     = useState('')
  const [sortBy,     setSortBy]     = useState<SortBy>('invoice_date')
  const [sortDir,    setSortDir]    = useState<SortDir>('desc')

  const { data, loading, error, reload } = useQuery(
    () => getInvoices({ supplier_id: supplierId, date_from: dateFrom, date_to: dateTo, sort_by: sortBy, sort_dir: sortDir }),
    [supplierId, dateFrom, dateTo, sortBy, sortDir],
  )
  const { data: suppliers } = useQuery(getSuppliers)
  const [detail,    setDetail]    = useState<InvoiceDetail | null>(null)
  const [editState, setEditState] = useState<EditState | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const enterEdit = (d: InvoiceDetail) => {
    setEditState({
      invoice_date:   String(d.invoice_date),
      invoice_number: d.invoice_number,
      invoice_type:   d.invoice_type as 'invoice' | 'credit_note',
      delivery_date:  d.delivery_date ? String(d.delivery_date) : '',
      notes:          d.notes ?? '',
    })
    setSaveError(null)
  }

  const cancelEdit = () => { setEditState(null); setSaveError(null) }

  const saveMutation = useMutation(async () => {
    if (!detail || !editState) return
    if (!editState.invoice_date || !editState.invoice_number.trim())
      throw new Error('Date and invoice number are required')
    const payload: InvoiceUpdate = {
      invoice_date:   editState.invoice_date,
      invoice_number: editState.invoice_number.trim(),
      invoice_type:   editState.invoice_type,
      delivery_date:  editState.delivery_date || null,
      notes:          editState.notes.trim() || null,
    }
    await updateInvoice(detail.id, payload)
    const refreshed = await getInvoice(detail.id)
    setDetail(refreshed)
    setEditState(null)
    await reload()
  })

  // Attach-receipt sub-panel: which invoice line are we linking?
  const [attachLineId,    setAttachLineId]    = useState<number | null>(null)
  const [pendingReceipts, setPendingReceipts] = useState<PendingReceiptOut[] | null>(null)
  const [attachLoading,  setAttachLoading]  = useState(false)
  const [attachError,    setAttachError]    = useState<string | null>(null)

  const openDetail = useMutation(async (id: number) => {
    const d = await getInvoice(id)
    setDetail(d)
  })

  const openAttach = async (lineId: number, productId: number) => {
    setAttachLineId(lineId)
    setAttachError(null)
    setPendingReceipts(null)
    try {
      const receipts = await getPendingReceipts(productId)
      setPendingReceipts(receipts)
    } catch {
      setAttachError('Failed to load pending receipts')
    }
  }

  const doLink = async (movementId: number) => {
    if (!attachLineId) return
    setAttachLoading(true)
    setAttachError(null)
    try {
      await linkReceiptToInvoiceLine(movementId, attachLineId)
      setAttachLineId(null)
      setPendingReceipts(null)
      // reload the detail to reflect any changes
      if (detail) {
        const d = await getInvoice(detail.id)
        setDetail(d)
      }
    } catch (e: unknown) {
      setAttachError(e instanceof Error ? e.message : 'Failed to link')
    } finally {
      setAttachLoading(false)
    }
  }

  const closeAttach = () => {
    setAttachLineId(null)
    setPendingReceipts(null)
    setAttachError(null)
  }

  const deleteMutation = useMutation(async (id: number) => {
    await deleteInvoice(id)
    setDetail(null)
    await reload()
  })

  const handleSort = (col: SortBy) => {
    if (col === sortBy) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortBy(col)
      setSortDir(col === 'invoice_date' ? 'desc' : 'asc')
    }
  }

  const SortHeader = ({ col, label }: { col: SortBy; label: string }) => (
    <th
      onClick={() => handleSort(col)}
      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
    >
      {label}
      {sortBy === col && (
        <span style={{ marginLeft: '.3rem', fontSize: '.75rem' }}>
          {sortDir === 'desc' ? '▼' : '▲'}
        </span>
      )}
    </th>
  )

  const clearFilters = () => {
    setSupplierId('')
    setDateFrom('')
    setDateTo('')
  }

  const hasFilters = supplierId !== '' || dateFrom !== '' || dateTo !== ''

  if (loading) return <Spinner />
  if (error)   return <p style={{ color: 'red' }}>{error}</p>
  if (!data)   return null

  const sign = (i: { invoice_type: string }) => i.invoice_type === 'credit_note' ? -1 : 1
  const totalGross = data.reduce((s, i) => s + sign(i) * i.gross_amount, 0)
  const totalVat   = data.reduce((s, i) => s + sign(i) * i.vat_amount,   0)
  const avgInvoice = data.length ? totalGross / data.length : 0

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Invoices ({data.length})</h1>

      {/* Stats bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '.75rem', marginBottom: '1.25rem' }}>
        {[
          { label: 'Count',       value: data.length },
          { label: 'Total Gross', value: `€${eur(totalGross)}`, color: '#4f46e5' },
          { label: 'Total VAT',   value: `€${eur(totalVat)}` },
          { label: 'Avg Invoice', value: data.length ? `€${eur(avgInvoice)}` : '—' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '.75rem 1rem', textAlign: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: '1.15rem', color: (s as {color?: string}).color ?? '#111827' }}>{s.value}</div>
            <div style={{ fontSize: '.72rem', color: '#6b7280', marginTop: '.2rem', textTransform: 'uppercase', letterSpacing: '.04em' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: '.75rem', alignItems: 'flex-end', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
          <span style={{ fontSize: '.8rem', color: '#6b7280', fontWeight: 500 }}>Supplier</span>
          <select
            value={supplierId}
            onChange={e => setSupplierId(e.target.value ? +e.target.value : '')}
            style={{ minWidth: 180 }}
          >
            <option value="">All suppliers</option>
            {(suppliers ?? []).filter((s, i, arr) => {
              const label = s.trade_name ?? s.name
              return arr.findIndex(x => (x.trade_name ?? x.name) === label) === i
            }).map(s => (
              <option key={s.id} value={s.id}>{s.trade_name ?? s.name}</option>
            ))}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
          <span style={{ fontSize: '.8rem', color: '#6b7280', fontWeight: 500 }}>From</span>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            style={{ width: 150 }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
          <span style={{ fontSize: '.8rem', color: '#6b7280', fontWeight: 500 }}>To</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            style={{ width: 150 }}
          />
        </label>

        {hasFilters && (
          <button className="btn-secondary" onClick={clearFilters} style={{ alignSelf: 'flex-end' }}>
            Clear filters
          </button>
        )}
      </div>

      {openDetail.error && (
        <p style={{ color: '#b91c1c', fontSize: '.85rem' }}>{openDetail.error}</p>
      )}

      <table>
        <thead>
          <tr>
            <th>Invoice #</th>
            <SortHeader col="invoice_date"   label="Date" />
            <SortHeader col="supplier_name"  label="Supplier" />
            <th>Net</th><th>VAT</th><th>Gross</th><th>Lines</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>
          {data.length === 0 && (
            <tr><td colSpan={9} style={{ color: '#9ca3af', textAlign: 'center', padding: '2rem' }}>
              No invoices match the current filters.
            </td></tr>
          )}
          {data.map(i => (
            <tr key={i.id}>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                  <button
                    style={{ background: 'none', color: '#4f46e5', padding: 0, fontWeight: 500 }}
                    onClick={() => openDetail.mutate(i.id)}
                  >{i.invoice_number}</button>
                  {i.invoice_type === 'credit_note' && (
                    <span style={{ background: '#fef9c3', border: '1px solid #fbbf24', color: '#92400e', fontSize: '.68rem', fontWeight: 700, padding: '1px 5px', borderRadius: 3 }}>
                      CREDIT
                    </span>
                  )}
                </div>
              </td>
              <td>{i.invoice_date}</td>
              <td>{i.supplier_name}</td>
              <td>€{eur(i.net_amount)}</td>
              <td>€{eur(i.vat_amount)}</td>
              <td>€{eur(i.gross_amount)}</td>
              <td>{i.line_count}</td>
              <td><span className="badge">{i.status}</span></td>
              <td>
                <button
                  className="btn-danger"
                  disabled={deleteMutation.loading}
                  onClick={() => {
                    if (confirmInvoiceDelete(i.invoice_number))
                      deleteMutation.mutate(i.id)
                  }}
                >Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {detail && (
        <>
          <div
            onClick={() => setDetail(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 40 }}
          />
          <div style={{
            position: 'fixed', top: '5%', left: '50%', transform: 'translateX(-50%)',
            background: '#fff', borderRadius: '.75rem', zIndex: 50,
            width: '90%', maxWidth: 900, maxHeight: '85vh',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 20px 60px rgba(0,0,0,.25)',
          }}>
            <div style={{ padding: '1.1rem 1.5rem', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
              {editState ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto auto', gap: '.6rem', flex: 1, alignItems: 'center' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                    <span style={{ fontSize: '.68rem', color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase' }}>Invoice #</span>
                    <input
                      value={editState.invoice_number}
                      onChange={e => setEditState(s => s && ({ ...s, invoice_number: e.target.value }))}
                      style={{ padding: '.3rem .5rem', fontSize: '.88rem' }}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                    <span style={{ fontSize: '.68rem', color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase' }}>Date</span>
                    <input
                      type="date"
                      value={editState.invoice_date}
                      onChange={e => setEditState(s => s && ({ ...s, invoice_date: e.target.value }))}
                      style={{ padding: '.3rem .5rem', fontSize: '.88rem' }}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                    <span style={{ fontSize: '.68rem', color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase' }}>Type</span>
                    <select
                      value={editState.invoice_type}
                      onChange={e => setEditState(s => s && ({ ...s, invoice_type: e.target.value as 'invoice' | 'credit_note' }))}
                      style={{ padding: '.3rem .5rem', fontSize: '.88rem' }}
                    >
                      <option value="invoice">Invoice</option>
                      <option value="credit_note">Credit Note</option>
                    </select>
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                    <span style={{ fontSize: '.68rem', color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase' }}>Delivery date</span>
                    <input
                      type="date"
                      value={editState.delivery_date}
                      onChange={e => setEditState(s => s && ({ ...s, delivery_date: e.target.value }))}
                      style={{ padding: '.3rem .5rem', fontSize: '.88rem' }}
                    />
                  </label>
                </div>
              ) : (
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>{detail.invoice_number}</span>
                  {detail.invoice_type === 'credit_note' && (
                    <span style={{ background: '#fef9c3', border: '1px solid #fbbf24', color: '#92400e', fontSize: '.72rem', fontWeight: 700, padding: '2px 7px', borderRadius: 4, marginLeft: '.5rem' }}>
                      CREDIT NOTE
                    </span>
                  )}
                  <span style={{ color: '#6b7280', marginLeft: '1rem' }}>{detail.supplier_name} — {detail.invoice_date}</span>
                  {detail.delivery_date && <span style={{ color: '#9ca3af', marginLeft: '.75rem', fontSize: '.82rem' }}>Delivered {detail.delivery_date}</span>}
                  <span style={{ color: '#9ca3af', marginLeft: '.75rem', fontSize: '.82rem' }}>{detail.lines.length} line{detail.lines.length !== 1 ? 's' : ''}</span>
                </div>
              )}
              <div style={{ display: 'flex', gap: '.5rem', flexShrink: 0 }}>
                {!editState && (
                  <button
                    onClick={() => enterEdit(detail)}
                    style={{ padding: '.35rem .85rem', background: '#111827', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '.82rem', fontWeight: 600 }}
                  >
                    Edit
                  </button>
                )}
                <button className="btn-secondary" onClick={() => { setDetail(null); setEditState(null) }}>✕</button>
              </div>
            </div>
            <div style={{ padding: '1rem 1.5rem', overflowY: 'auto', flex: 1 }}>
              {editState && (
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', maxWidth: 420 }}>
                    <span style={{ fontSize: '.68rem', color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase' }}>Notes</span>
                    <textarea
                      rows={2}
                      value={editState.notes}
                      onChange={e => setEditState(s => s && ({ ...s, notes: e.target.value }))}
                      style={{ padding: '.4rem .6rem', fontSize: '.85rem', resize: 'vertical', fontFamily: 'inherit' }}
                      placeholder="Optional notes…"
                    />
                  </label>
                </div>
              )}
              <table>
                <thead>
                  <tr><th>Product</th><th>SKU</th><th>Qty</th><th>Unit</th><th>Price</th><th>Disc%</th><th>Net</th><th>Gross</th><th></th></tr>
                </thead>
                <tbody>
                  {detail.lines.map(l => (
                    <tr key={l.id}>
                      <td>{l.product_name ?? l.line_description}</td>
                      <td style={{ fontSize: '.8rem', color: '#6b7280' }}>{l.supplier_sku ?? '—'}</td>
                      <td>{l.quantity}</td>
                      <td>{l.unit}</td>
                      <td>€{eur(l.unit_price)}</td>
                      <td>{l.discount_percent > 0 ? `${l.discount_percent}%` : '—'}</td>
                      <td>€{eur(l.line_net_amount)}</td>
                      <td>€{eur(l.line_gross_amount)}</td>
                      <td>
                        {l.product_id != null && (
                          <button
                            onClick={() => openAttach(l.id, l.product_id!)}
                            style={{
                              padding: '.2rem .5rem', fontSize: '.72rem', cursor: 'pointer',
                              background: '#f5f3ff', border: '1px solid #c4b5fd', borderRadius: 4,
                              color: '#6d28d9', fontWeight: 600, whiteSpace: 'nowrap',
                            }}
                            title="Link a pending receipt to this line"
                          >
                            Attach Receipt
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Attach-receipt sub-panel */}
              {attachLineId != null && (
                <div style={{
                  marginTop: '1rem', border: '1px solid #c4b5fd', borderRadius: 8,
                  background: '#faf5ff', padding: '1rem',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.75rem' }}>
                    <div style={{ fontWeight: 600, fontSize: '.88rem', color: '#4c1d95' }}>Pending receipts for this product</div>
                    <button onClick={closeAttach} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: '1rem' }}>×</button>
                  </div>
                  {pendingReceipts === null && !attachError && (
                    <div style={{ color: '#6b7280', fontSize: '.82rem' }}>Loading…</div>
                  )}
                  {attachError && <div style={{ color: '#dc2626', fontSize: '.82rem' }}>{attachError}</div>}
                  {pendingReceipts !== null && pendingReceipts.length === 0 && (
                    <div style={{ color: '#6b7280', fontSize: '.82rem' }}>No unlinked pending receipts for this product.</div>
                  )}
                  {pendingReceipts !== null && pendingReceipts.length > 0 && (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.82rem' }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left', padding: '.3rem .5rem', color: '#6b7280', fontWeight: 600, fontSize: '.72rem', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Date</th>
                          <th style={{ textAlign: 'left', padding: '.3rem .5rem', color: '#6b7280', fontWeight: 600, fontSize: '.72rem', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Location</th>
                          <th style={{ textAlign: 'right', padding: '.3rem .5rem', color: '#6b7280', fontWeight: 600, fontSize: '.72rem', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Qty</th>
                          <th style={{ textAlign: 'left', padding: '.3rem .5rem', color: '#6b7280', fontWeight: 600, fontSize: '.72rem', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Notes</th>
                          <th style={{ borderBottom: '1px solid #e5e7eb' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {pendingReceipts.map(r => (
                          <tr key={r.id}>
                            <td style={{ padding: '.3rem .5rem' }}>{r.moved_at.slice(0, 10)}</td>
                            <td style={{ padding: '.3rem .5rem' }}>{r.location_name ?? '—'}</td>
                            <td style={{ padding: '.3rem .5rem', textAlign: 'right' }}>{r.quantity}{r.unit ? ` ${r.unit}` : ''}</td>
                            <td style={{ padding: '.3rem .5rem', color: '#6b7280' }}>{r.notes ?? '—'}</td>
                            <td style={{ padding: '.3rem .5rem' }}>
                              <button
                                disabled={attachLoading}
                                onClick={() => doLink(r.id)}
                                style={{
                                  padding: '.2rem .55rem', fontSize: '.72rem', cursor: 'pointer',
                                  background: '#6d28d9', color: '#fff', border: 'none',
                                  borderRadius: 4, fontWeight: 600,
                                }}
                              >
                                Link
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
            <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid #e5e7eb', display: 'flex', gap: '1rem', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{ fontSize: '.9rem', color: '#6b7280' }}>
                  Net €{eur(detail.net_amount)} · VAT €{eur(detail.vat_amount)} · <strong>Gross €{eur(detail.gross_amount)}</strong>
                </div>
                {detail.pdf_path && !editState && (
                  <a
                    href={`/api/invoices/${detail.id}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-secondary"
                    style={{ fontSize: '.85rem', textDecoration: 'none' }}
                  >
                    View PDF
                  </a>
                )}
              </div>
              <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center' }}>
                {saveError && <span style={{ color: '#b91c1c', fontSize: '.85rem' }}>{saveError}</span>}
                {saveMutation.error && <span style={{ color: '#b91c1c', fontSize: '.85rem' }}>{saveMutation.error}</span>}
                {editState ? (
                  <>
                    <button className="btn-secondary" onClick={cancelEdit} disabled={saveMutation.loading}>
                      Cancel
                    </button>
                    <button
                      onClick={async () => {
                        setSaveError(null)
                        try { await saveMutation.mutate(undefined as void) }
                        catch (e: unknown) { setSaveError(e instanceof Error ? e.message : 'Save failed') }
                      }}
                      disabled={saveMutation.loading}
                      style={{ padding: '.4rem 1rem', background: '#111827', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: '.85rem' }}
                    >
                      {saveMutation.loading ? 'Saving…' : 'Save Changes'}
                    </button>
                  </>
                ) : (
                  <>
                    {deleteMutation.error && (
                      <span style={{ color: '#b91c1c', fontSize: '.85rem' }}>{deleteMutation.error}</span>
                    )}
                    <button
                      className="btn-danger"
                      disabled={deleteMutation.loading}
                      onClick={() => {
                        if (confirmInvoiceDelete(detail.invoice_number))
                          deleteMutation.mutate(detail.id)
                      }}
                    >
                      {deleteMutation.loading ? 'Deleting…' : 'Delete Invoice'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
