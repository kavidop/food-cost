import { useState } from 'react'
import { getSuppliers, getSupplier, updateSupplier, deleteSupplier, mergeSupplier, getInvoice, getCategories } from '@/api/client'
import { useQuery }    from '@/hooks/useAsync'
import { useMutation } from '@/hooks/useMutation'
import Spinner         from '@/components/Spinner'
import type { SupplierListItem, SupplierDetail, InvoiceDetail } from '@/types/api'

const eur = (n: number) =>
  n.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type ViewMode = 'cards' | 'list'

export default function Suppliers() {
  const { data, loading, error, reload } = useQuery(getSuppliers)
  const { data: categories }             = useQuery(getCategories)

  const [selected,      setSelected]      = useState<SupplierDetail | null>(null)
  const [editing,       setEditing]       = useState(false)
  const [invoiceDetail, setInvoiceDetail] = useState<InvoiceDetail | null>(null)
  const [search,        setSearch]        = useState('')
  const [catFilter,     setCatFilter]     = useState('')
  const [viewMode,      setViewMode]      = useState<ViewMode>('cards')
  const [sortCol,       setSortCol]       = useState<'name' | 'invoices' | 'spend' | 'products'>('name')
  const [sortAsc,       setSortAsc]       = useState(true)
  const [mergeOpen,     setMergeOpen]     = useState(false)
  const [mergeSearch,   setMergeSearch]   = useState('')
  const [mergeTarget,   setMergeTarget]   = useState<number | null>(null)

  const openDetail = useMutation(async (s: SupplierListItem) => {
    const detail = await getSupplier(s.id)
    setSelected(detail)
    setEditing(false)
  })

  const loadInvoice = useMutation(async (id: number) => {
    const detail = await getInvoice(id)
    setInvoiceDetail(detail)
  })

  const saveMutation = useMutation(async () => {
    if (!selected) return
    await updateSupplier(selected.id, selected)
    await reload()
    setEditing(false)
  })

  const deleteMutation = useMutation(async () => {
    if (!selected) return
    await deleteSupplier(selected.id)
    setSelected(null)
    await reload()
  })

  const mergeMutation = useMutation(async () => {
    if (!selected || !mergeTarget) return
    await mergeSupplier(selected.id, mergeTarget)
    setSelected(null)
    setMergeOpen(false)
    setMergeTarget(null)
    await reload()
  })

  const closeMerge = () => { setMergeOpen(false); setMergeTarget(null); mergeMutation.reset() }

  if (loading) return <Spinner />
  if (error)   return <p style={{ color: 'red' }}>{error}</p>
  if (!data)   return null

  const toggleSort = (col: typeof sortCol) => {
    if (sortCol === col) setSortAsc(a => !a)
    else { setSortCol(col); setSortAsc(col === 'name') }
  }

  const filtered = data.filter(s => {
    const name = (s.trade_name || s.name).toLowerCase()
    if (search && !name.includes(search.toLowerCase())) return false
    if (catFilter && s.primary_category !== catFilter)   return false
    return true
  }).sort((a, b) => {
    let cmp = 0
    if (sortCol === 'name')     cmp = (a.trade_name || a.name).localeCompare(b.trade_name || b.name)
    if (sortCol === 'invoices') cmp = a.invoice_count - b.invoice_count
    if (sortCol === 'spend')    cmp = a.total_spend - b.total_spend
    if (sortCol === 'products') cmp = a.product_count - b.product_count
    return sortAsc ? cmp : -cmp
  })

  const totalSpend    = filtered.reduce((s, x) => s + x.total_spend, 0)
  const totalInvoices = filtered.reduce((s, x) => s + x.invoice_count, 0)

  // Categories sorted alphabetically for the select
  const catOptions = [...(categories ?? [])].sort((a, b) => a.name.localeCompare(b.name))

  const SortTh = ({ col, label, align = 'left' }: { col: typeof sortCol; label: string; align?: string }) => (
    <th
      onClick={() => toggleSort(col)}
      style={{ cursor: 'pointer', userSelect: 'none', textAlign: align as 'left' | 'right', whiteSpace: 'nowrap' }}
    >
      {label}
      {sortCol === col && <span style={{ marginLeft: '.3rem', fontSize: '.75rem' }}>{sortAsc ? '▲' : '▼'}</span>}
    </th>
  )

  return (
    <div>
      {/* ── Stats bar ────────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '.75rem', marginBottom: '1.25rem' }}>
        {[
          { label: 'Suppliers',     value: filtered.length },
          { label: 'Total Spend',   value: `€${eur(totalSpend)}`,    color: '#4f46e5' },
          { label: 'Total Invoices',value: totalInvoices },
          { label: 'Avg Spend',     value: filtered.length ? `€${eur(totalSpend / filtered.length)}` : '—' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '.75rem 1rem', textAlign: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: '1.15rem', color: (s as {color?: string}).color ?? '#111827' }}>{s.value}</div>
            <div style={{ fontSize: '.72rem', color: '#6b7280', marginTop: '.2rem', textTransform: 'uppercase', letterSpacing: '.04em' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
        <h1 style={{ margin: 0 }}>Suppliers ({filtered.length})</h1>

        {/* View toggle */}
        <div style={{ display: 'flex', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
          <button
            onClick={() => setViewMode('cards')}
            style={{
              padding: '5px 12px', fontSize: '.8rem', border: 'none', cursor: 'pointer',
              background: viewMode === 'cards' ? '#4f46e5' : '#fff',
              color:      viewMode === 'cards' ? '#fff'     : '#6b7280',
              fontWeight: viewMode === 'cards' ? 600 : 400,
            }}
          >⊞ Cards</button>
          <button
            onClick={() => setViewMode('list')}
            style={{
              padding: '5px 12px', fontSize: '.8rem', border: 'none', borderLeft: '1px solid #e5e7eb', cursor: 'pointer',
              background: viewMode === 'list' ? '#4f46e5' : '#fff',
              color:      viewMode === 'list' ? '#fff'     : '#6b7280',
              fontWeight: viewMode === 'list' ? 600 : 400,
            }}
          >☰ List</button>
        </div>
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '.75rem', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          placeholder="Search suppliers…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: 260 }}
        />
        <select
          value={catFilter}
          onChange={e => setCatFilter(e.target.value)}
          style={{ maxWidth: 220 }}
        >
          <option value="">All categories</option>
          {catOptions.map(c => (
            <option key={c.id} value={c.name}>{c.name}</option>
          ))}
        </select>
        {catFilter && (
          <button className="btn-secondary" style={{ fontSize: '.8rem', padding: '4px 10px' }} onClick={() => setCatFilter('')}>
            ✕ Clear
          </button>
        )}
      </div>

      {/* ── Cards view ──────────────────────────────────────────────────────── */}
      {viewMode === 'cards' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: '1rem' }}>
          {filtered.map(s => (
            <div
              key={s.id}
              className="card card-hover"
              style={{ cursor: 'pointer', borderLeft: '4px solid #e5e7eb' }}
              onClick={() => openDetail.mutate(s)}
            >
              <div style={{ fontWeight: 600, fontSize: '1rem' }}>
                {s.trade_name || s.name}
              </div>
              {s.trade_name && <div style={{ color: '#6b7280', fontSize: '.8rem' }}>{s.name}</div>}
              <div style={{ marginTop: '.75rem', display: 'flex', gap: '1rem', fontSize: '.85rem' }}>
                <span><strong>{s.invoice_count}</strong> invoices</span>
                <span><strong>{s.product_count}</strong> products</span>
              </div>
              <div style={{ marginTop: '.25rem', fontSize: '.85rem', color: '#4f46e5' }}>
                €{eur(s.total_spend)}
              </div>
              {s.primary_category && (
                <span className="badge" style={{ marginTop: '.5rem' }}>{s.primary_category}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── List view ───────────────────────────────────────────────────────── */}
      {viewMode === 'list' && (
        <table>
          <thead>
            <tr>
              <SortTh col="name"     label="Supplier" />
              <th>VAT</th>
              <th>Category</th>
              <SortTh col="invoices" label="Invoices" align="right" />
              <SortTh col="products" label="Products" align="right" />
              <SortTh col="spend"    label="Total Spend" align="right" />
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(s => (
              <tr key={s.id}>
                <td>
                  <div style={{ fontWeight: 500 }}>{s.trade_name || s.name}</div>
                  {s.trade_name && (
                    <div style={{ fontSize: '.75rem', color: '#9ca3af' }}>{s.name}</div>
                  )}
                </td>
                <td style={{ fontSize: '.8rem', color: '#6b7280', fontFamily: 'monospace' }}>
                  {s.vat_number ?? '—'}
                </td>
                <td>
                  {s.primary_category
                    ? <span className="badge">{s.primary_category}</span>
                    : <span style={{ color: '#9ca3af' }}>—</span>
                  }
                </td>
                <td style={{ textAlign: 'right' }}>{s.invoice_count}</td>
                <td style={{ textAlign: 'right' }}>{s.product_count}</td>
                <td style={{ textAlign: 'right', color: '#4f46e5', fontWeight: 500 }}>
                  €{eur(s.total_spend)}
                </td>
                <td>
                  <button className="btn-secondary" onClick={() => openDetail.mutate(s)}>View</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {filtered.length === 0 && (
        <p style={{ color: '#9ca3af', marginTop: '2rem', textAlign: 'center' }}>
          No suppliers match your filters.
        </p>
      )}

      {/* ── Slide-over detail panel ─────────────────────────────────────────── */}
      {selected && (
        <>
          <div
            onClick={() => setSelected(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.3)', zIndex: 40 }}
          />
          <aside style={{
            position: 'fixed', right: 0, top: 0, bottom: 0, width: 520,
            background: '#fff', zIndex: 50, overflowY: 'auto', padding: '1.5rem',
            boxShadow: '-4px 0 20px rgba(0,0,0,.15)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>{selected.trade_name || selected.name}</h2>
              <button className="btn-secondary" onClick={() => setSelected(null)}>✕</button>
            </div>

            {editing ? (
              <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
                {(['name','trade_name','vat_number','phone','email','address'] as const).map(f => (
                  <label key={f}>
                    <div style={{ fontSize: '.8rem', marginBottom: '.2rem', textTransform: 'capitalize' }}>
                      {f.replace('_', ' ')}
                    </div>
                    <input
                      value={selected[f] ?? ''}
                      onChange={e => setSelected({ ...selected, [f]: e.target.value })}
                    />
                  </label>
                ))}
                {(saveMutation.error || deleteMutation.error) && (
                  <p style={{ color: '#b91c1c', fontSize: '.85rem', margin: 0 }}>
                    {saveMutation.error || deleteMutation.error}
                  </p>
                )}
                <div style={{ display: 'flex', gap: '.5rem' }}>
                  <button
                    className="btn-primary"
                    disabled={saveMutation.loading}
                    onClick={() => saveMutation.mutate(undefined as void)}
                  >
                    {saveMutation.loading ? 'Saving…' : 'Save'}
                  </button>
                  <button className="btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
                  <button
                    className="btn-danger"
                    disabled={deleteMutation.loading}
                    onClick={() => {
                      if (confirm('Delete this supplier?')) deleteMutation.mutate(undefined as void)
                    }}
                  >
                    {deleteMutation.loading ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                  {[
                    { label: 'Invoices',    v: selected.stats.invoice_count },
                    { label: 'Products',    v: selected.stats.product_count },
                    { label: 'Total Spend', v: `€${eur(selected.stats.total_spend)}` },
                  ].map(s => (
                    <div key={s.label} className="card" style={{ padding: '.75rem', textAlign: 'center' }}>
                      <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{s.v}</div>
                      <div style={{ fontSize: '.75rem', color: '#6b7280' }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                <button
                  className="btn-secondary"
                  style={{ marginTop: '.75rem' }}
                  onClick={() => setEditing(true)}
                >Edit</button>
                <button
                  className="btn-secondary"
                  style={{ marginTop: '.75rem', marginLeft: '.5rem', background: '#fef3c7', border: '1px solid #f59e0b', color: '#92400e' }}
                  onClick={() => { setMergeOpen(true); setMergeTarget(null); setMergeSearch(''); mergeMutation.reset() }}
                >Merge</button>

                <h4 style={{ marginBottom: '.5rem' }}>Recent Invoices</h4>
                <table>
                  <thead><tr><th>Invoice #</th><th>Date</th><th>Gross</th></tr></thead>
                  <tbody>
                    {selected.invoices.slice(0, 6).map(i => (
                      <tr key={i.id}>
                        <td>
                          <button
                            style={{ background: 'none', color: '#4f46e5', padding: 0, fontWeight: 500 }}
                            onClick={() => loadInvoice.mutate(i.id)}
                          >{i.invoice_number}</button>
                          {i.invoice_type === 'credit_note' && (
                            <span style={{
                              marginLeft: 6, fontSize: '.65rem', fontWeight: 700,
                              background: '#fee2e2', color: '#991b1b',
                              padding: '1px 5px', borderRadius: 3,
                              verticalAlign: 'middle',
                            }}>CN</span>
                          )}
                        </td>
                        <td>{i.invoice_date}</td>
                        <td style={{ color: i.invoice_type === 'credit_note' ? '#991b1b' : undefined }}>
                          {i.invoice_type === 'credit_note' ? '−' : ''}€{eur(i.gross_amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <h4 style={{ marginBottom: '.5rem', marginTop: '1rem' }}>Products</h4>
                <table>
                  <thead><tr><th>Name</th><th>SKU</th><th>Price</th></tr></thead>
                  <tbody>
                    {selected.products.map(p => (
                      <tr key={p.id}>
                        <td>{p.name}</td>
                        <td style={{ color: '#6b7280', fontSize: '.8rem' }}>{p.supplier_sku ?? '—'}</td>
                        <td>{p.current_price != null ? `€${eur(p.current_price)}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </aside>
        </>
      )}

      {/* ── Invoice detail modal — floats above the supplier aside ───────────── */}
      {invoiceDetail && (
        <>
          <div
            onClick={() => setInvoiceDetail(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 60 }}
          />
          <div style={{
            position: 'fixed', top: '5%', left: '50%', transform: 'translateX(-50%)',
            background: '#fff', borderRadius: '.75rem', zIndex: 70,
            width: '90%', maxWidth: 860, maxHeight: '85vh',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 20px 60px rgba(0,0,0,.3)',
          }}>
            <div style={{ padding: '1.1rem 1.5rem', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontWeight: 700, fontSize: '1.05rem' }}>{invoiceDetail.invoice_number}</span>
                {invoiceDetail.invoice_type === 'credit_note' && (
                  <span style={{
                    marginLeft: 8, fontSize: '.72rem', fontWeight: 700,
                    background: '#fee2e2', color: '#991b1b',
                    padding: '2px 8px', borderRadius: 4,
                    verticalAlign: 'middle',
                  }}>Credit Note</span>
                )}
                <span style={{ color: '#6b7280', marginLeft: '1rem', fontSize: '.9rem' }}>
                  {invoiceDetail.supplier_name} — {invoiceDetail.invoice_date}
                </span>
              </div>
              <button className="btn-secondary" onClick={() => setInvoiceDetail(null)}>✕</button>
            </div>

            <div style={{ padding: '1rem 1.5rem', overflowY: 'auto', flex: 1 }}>
              <table>
                <thead>
                  <tr>
                    <th>Product</th><th>SKU</th><th>Qty</th><th>Unit</th>
                    <th>Price</th><th>Disc%</th><th>Net</th><th>Gross</th>
                  </tr>
                </thead>
                <tbody>
                  {invoiceDetail.lines.map(l => (
                    <tr key={l.id}>
                      <td>{l.product_name ?? l.line_description}</td>
                      <td style={{ fontSize: '.8rem', color: '#6b7280' }}>{l.supplier_sku ?? '—'}</td>
                      <td>{l.quantity}</td>
                      <td>{l.unit}</td>
                      <td>€{eur(l.unit_price)}</td>
                      <td>{l.discount_percent > 0 ? `${l.discount_percent}%` : '—'}</td>
                      <td>€{eur(l.line_net_amount)}</td>
                      <td>€{eur(l.line_gross_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid #e5e7eb', fontSize: '.9rem', color: '#6b7280' }}>
              Net €{eur(invoiceDetail.net_amount)} · VAT €{eur(invoiceDetail.vat_amount)} · <strong style={{ color: '#111827' }}>Gross €{eur(invoiceDetail.gross_amount)}</strong>
            </div>
          </div>
        </>
      )}
      {/* ── Merge modal ───────────────────────────────────────────────────── */}
      {selected && mergeOpen && (
        <>
          <div
            onClick={closeMerge}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 60 }}
          />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            background: '#fff', borderRadius: '.75rem', zIndex: 70,
            width: '90%', maxWidth: 480,
            boxShadow: '0 24px 64px rgba(0,0,0,.28)',
            padding: '1.5rem',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Merge Supplier</h2>
              <button onClick={closeMerge} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: '#6b7280' }}>×</button>
            </div>

            <p style={{ fontSize: '.85rem', color: '#374151', marginBottom: '.75rem' }}>
              Merge <strong>"{selected.trade_name || selected.name}"</strong> into another supplier.
              All invoices and products will be reassigned, and this supplier will be deleted.
            </p>

            {!mergeTarget ? (
              <>
                <input
                  placeholder="Search target supplier…"
                  value={mergeSearch}
                  onChange={e => setMergeSearch(e.target.value)}
                  style={{ width: '100%', marginBottom: '.5rem', boxSizing: 'border-box' }}
                  autoFocus
                />
                <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 6 }}>
                  {data.filter(s => {
                    const nm = (s.trade_name || s.name).toLowerCase()
                    return s.id !== selected.id && (!mergeSearch || nm.includes(mergeSearch.toLowerCase()))
                  }).slice(0, 20).map(s => (
                    <div
                      key={s.id}
                      onClick={() => setMergeTarget(s.id)}
                      style={{
                        padding: '.4rem .6rem', cursor: 'pointer', fontSize: '.85rem',
                        borderBottom: '1px solid #f3f4f6',
                      }}
                    >
                      {s.trade_name || s.name}
                      {s.vat_number && <span style={{ color: '#9ca3af', marginLeft: '.5rem', fontSize: '.75rem' }}>{s.vat_number}</span>}
                    </div>
                  ))}
                  {data.filter(s => {
                    const nm = (s.trade_name || s.name).toLowerCase()
                    return s.id !== selected.id && (!mergeSearch || nm.includes(mergeSearch.toLowerCase()))
                  }).length === 0 && (
                    <div style={{ padding: '.5rem', color: '#9ca3af', fontSize: '.8rem', textAlign: 'center' }}>No matching suppliers</div>
                  )}
                </div>
              </>
            ) : (
              <div style={{ padding: '.75rem', background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 6, marginBottom: '.75rem' }}>
                <p style={{ margin: 0, fontSize: '.85rem' }}>
                  <strong>"{selected.trade_name || selected.name}"</strong> will be merged into{' '}
                  <strong>"{data.find(s => s.id === mergeTarget)?.trade_name || data.find(s => s.id === mergeTarget)?.name}"</strong>.
                  All invoices and products will be reassigned. This cannot be undone.
                </p>
              </div>
            )}

            {mergeMutation.error && (
              <p style={{ color: '#dc2626', fontSize: '.82rem', marginBottom: '.6rem' }}>{mergeMutation.error}</p>
            )}

            <div style={{ display: 'flex', gap: '.6rem', justifyContent: 'flex-end', marginTop: '.75rem' }}>
              <button
                onClick={closeMerge}
                style={{ padding: '.4rem .9rem', background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: '.85rem' }}
              >
                Cancel
              </button>
              {mergeTarget && (
                <button
                  disabled={mergeMutation.loading}
                  onClick={() => { if (confirm('Merge and delete this supplier?')) mergeMutation.mutate(undefined as void) }}
                  style={{
                    padding: '.4rem 1rem', background: '#b45309', color: '#fff',
                    border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: '.85rem',
                  }}
                >
                  {mergeMutation.loading ? 'Merging…' : 'Merge & Delete'}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
