import { useState, useRef, useEffect } from 'react'
import { extractPdf, importInvoices, checkDuplicate, getProviders, getSuppliers, getSupplier, getUnits, attachInvoicePdf, suggestLocations, getStockLocations } from '@/api/client'
import { useQuery } from '@/hooks/useAsync'
import type {
  ExtractedInvoice, ExtractedLineItem, ExtractedSupplier, DuplicateCheckResponse, ImportResponse,
  SupplierProductSummary,
} from '@/types/api'

const eur = (n: number) =>
  n.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type Step = 'upload' | 'extracting' | 'review' | 'importing' | 'done'

interface InvoiceReviewItem {
  invoice: ExtractedInvoice
  selected: boolean
  dupCheck: DuplicateCheckResponse | null
  expanded: boolean
  supplierOpen: boolean
  linkedSupplierId: number | null
  supplierProducts: SupplierProductSummary[]
  defaultLocationId: number | null
}

const emptyLine = (locationId: number | null = null): ExtractedLineItem => ({
  supplier_sku: null, description: '', quantity: 1, unit: '',
  unit_price: 0, discount_percent: 0, line_net_amount: 0,
  vat_rate: 0, excise_duty_per_unit: 0, line_gross_amount: 0,
  location_id: locationId,
})

const recalcTotals = (lines: ExtractedLineItem[]) => ({
  net_amount:   Math.round(lines.reduce((s, l) => s + l.line_net_amount, 0) * 100) / 100,
  vat_amount:   Math.round(lines.reduce((s, l) => s + l.line_net_amount * l.vat_rate / 100, 0) * 100) / 100,
  gross_amount: Math.round(lines.reduce((s, l) => s + l.line_gross_amount, 0) * 100) / 100,
})

export default function Import() {
  const { data: providers } = useQuery(getProviders)
  const { data: suppliers } = useQuery(getSuppliers)
  const { data: units }     = useQuery(getUnits)
  const { data: locations } = useQuery(getStockLocations)

  const [step,          setStep]          = useState<Step>('upload')
  const [provider]                        = useState('gemini')
  const [model,         setModel]         = useState('')
  const [file,          setFile]          = useState<File | null>(null)
  const [savePdf,       setSavePdf]       = useState(false)
  const [items,         setItems]         = useState<InvoiceReviewItem[]>([])
  const [result,        setResult]        = useState<ImportResponse | null>(null)
  const [error,         setError]         = useState<string | null>(null)
  const [showConfirm,   setShowConfirm]   = useState(false)
  const [suggestingIdx, setSuggestingIdx] = useState<number | null>(null)
  const [lineSearchText, setLineSearchText] = useState<Record<string, string>>({})
  const [lineSearchOpen, setLineSearchOpen] = useState<Record<string, boolean>>({})
  const [lineDropdownPos, setLineDropdownPos] = useState<Record<string, { top: number; left: number; width: number }>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const first = providers?.gemini.models[0]?.id
    if (first && !model) setModel(first)
  }, [providers])

  const handleFile = (f: File) => {
    if (!f.name.toLowerCase().endsWith('.pdf')) { setError('Only PDF files are accepted.'); return }
    setFile(f); setError(null)
  }

  const handleExtract = async () => {
    if (!file) return
    setStep('extracting'); setError(null)
    try {
      const data = await extractPdf(file, provider, model)
      const invoices: ExtractedInvoice[] = data.invoices ?? []
      const dupChecks = await Promise.all(
        invoices.map(inv =>
          inv.supplier?.vat_number && inv.invoice_number
            ? checkDuplicate(inv.supplier.vat_number, inv.invoice_number)
            : Promise.resolve<DuplicateCheckResponse>({ duplicate: false, existing: null })
        )
      )
      setItems(invoices.map((inv, i) => ({
        invoice: {
          ...inv,
          line_items: inv.line_items.map(l => ({ ...l, location_id: l.location_id ?? null })),
        },
        selected: !dupChecks[i].duplicate, dupCheck: dupChecks[i],
        expanded: false, supplierOpen: false, linkedSupplierId: null, supplierProducts: [],
        defaultLocationId: null,
      })))
      setStep('review')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStep('upload')
    }
  }

  const handleManual = () => {
    setItems([{
      invoice: {
        invoice_type: 'invoice',
        supplier: { name: '', trade_name: null, vat_number: null, phone: null, address: null },
        invoice_number: '', invoice_date: new Date().toISOString().slice(0, 10),
        net_amount: 0, vat_amount: 0, excise_duty_amount: 0, gross_amount: 0, line_items: [],
      },
      selected: true, dupCheck: null, expanded: true, supplierOpen: true,
      linkedSupplierId: null, supplierProducts: [], defaultLocationId: null,
    }])
    setStep('review')
  }

  const toggle = (i: number, key: 'selected' | 'expanded' | 'supplierOpen') =>
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [key]: !it[key] } : it))

  const patchSupplier = (i: number, patch: Partial<ExtractedSupplier>) =>
    setItems(prev => prev.map((it, idx) =>
      idx !== i ? it : { ...it, invoice: { ...it.invoice, supplier: { ...it.invoice.supplier, ...patch } } }
    ))

  const patchInvoiceMeta = (i: number, patch: Partial<Omit<ExtractedInvoice, 'supplier' | 'line_items'>>) =>
    setItems(prev => prev.map((it, idx) =>
      idx !== i ? it : { ...it, invoice: { ...it.invoice, ...patch } }
    ))

  const patchLineItem = (invoiceIndex: number, lineIndex: number, patch: Partial<ExtractedLineItem>) =>
    setItems(prev => prev.map((it, idx) => {
      if (idx !== invoiceIndex) return it
      const newLines = it.invoice.line_items.map((line, li) => li === lineIndex ? { ...line, ...patch } : line)
      return { ...it, invoice: { ...it.invoice, line_items: newLines, ...recalcTotals(newLines) } }
    }))

  const addLineItem = (i: number) =>
    setItems(prev => prev.map((it, idx) => {
      if (idx !== i) return it
      const newLines = [...it.invoice.line_items, emptyLine(it.defaultLocationId)]
      return { ...it, expanded: true, invoice: { ...it.invoice, line_items: newLines, ...recalcTotals(newLines) } }
    }))

  const setDefaultLocation = (invoiceIdx: number, locId: number | null) =>
    setItems(prev => prev.map((it, idx) => {
      if (idx !== invoiceIdx) return it
      const newLines = it.invoice.line_items.map(l => ({ ...l, location_id: locId }))
      return { ...it, defaultLocationId: locId, invoice: { ...it.invoice, line_items: newLines } }
    }))

  const handleSuggest = async (invoiceIdx: number) => {
    const inv = items[invoiceIdx]
    const descriptions = inv.invoice.line_items.map(l => l.description)
    if (!descriptions.length) return
    setSuggestingIdx(invoiceIdx)
    try {
      const res = await suggestLocations(descriptions)
      setItems(prev => prev.map((it, idx) => {
        if (idx !== invoiceIdx) return it
        const newLines = it.invoice.line_items.map((l, li) => ({
          ...l,
          location_id: res.suggestions[li] ?? l.location_id,
        }))
        return { ...it, invoice: { ...it.invoice, line_items: newLines } }
      }))
    } catch { /* non-critical */ }
    setSuggestingIdx(null)
  }

  const removeLineItem = (i: number, j: number) =>
    setItems(prev => prev.map((it, idx) => {
      if (idx !== i) return it
      const newLines = it.invoice.line_items.filter((_, li) => li !== j)
      return { ...it, invoice: { ...it.invoice, line_items: newLines, ...recalcTotals(newLines) } }
    }))

  const loadSupplierProducts = async (invoiceIdx: number, supplierId: number) => {
    try {
      const detail = await getSupplier(supplierId)
      setItems(prev => prev.map((it, idx) =>
        idx !== invoiceIdx ? it : { ...it, linkedSupplierId: supplierId, supplierProducts: detail.products }
      ))
    } catch { /* Non-critical */ }
  }

  const selectSupplierProduct = (invoiceIdx: number, lineIdx: number, p: SupplierProductSummary) => {
    patchLineItem(invoiceIdx, lineIdx, {
      description: p.name, supplier_sku: p.supplier_sku,
      unit_price: p.current_price ?? 0, unit: p.unit ?? '',
    })
    const key = `${invoiceIdx}_${lineIdx}`
    setLineSearchOpen(s => { const n = { ...s }; delete n[key]; return n })
    setLineSearchText(s => { const n = { ...s }; delete n[key]; return n })
  }

  const recheckDup = async (i: number, vat: string, invoiceNumber: string) => {
    if (!vat || !invoiceNumber) {
      setItems(prev => prev.map((it, idx) =>
        idx !== i ? it : { ...it, dupCheck: { duplicate: false, existing: null } }
      ))
      return
    }
    try {
      const check = await checkDuplicate(vat, invoiceNumber)
      setItems(prev => prev.map((it, idx) => idx !== i ? it : { ...it, dupCheck: check }))
    } catch { /* Non-critical */ }
  }

  const toNumber = (value: string, fallback = 0) => {
    const n = Number(value); return Number.isFinite(n) ? n : fallback
  }

  const calcLine = (line: ExtractedLineItem, patch: Partial<ExtractedLineItem>): Partial<ExtractedLineItem> => {
    const m = { ...line, ...patch }
    const net   = m.quantity * m.unit_price * (1 - m.discount_percent / 100)
    const gross = net * (1 + m.vat_rate / 100)
    return { ...patch, line_net_amount: Math.round(net * 10000) / 10000, line_gross_amount: Math.round(gross * 10000) / 10000 }
  }

  const handleImport = async () => {
    const toImport = items.filter(it => it.selected).map(it => it.invoice)
    if (!toImport.length) return
    setShowConfirm(false)
    setStep('importing')
    try {
      const res = await importInvoices({ invoices: toImport })
      if (savePdf && file && res.invoice_ids.length > 0) await attachInvoicePdf(file, res.invoice_ids)
      setResult(res); setStep('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStep('review')
    }
  }

  const reset = () => {
    setStep('upload'); setFile(null); setItems([]); setResult(null)
    setError(null); setSavePdf(false); setShowConfirm(false)
  }

  const geminiModels = providers?.gemini.models ?? []

  // ── DONE ──────────────────────────────────────────────────────────────────
  if (step === 'done' && result) {
    return (
      <div>
        <h1 style={{ marginTop: 0 }}>Import Complete</h1>
        <div className="card" style={{ maxWidth: 560, background: '#f0fdf4', borderColor: '#86efac' }}>
          <div style={{ fontWeight: 700, color: '#15803d', fontSize: '1.1rem', marginBottom: '.5rem' }}>
            ✓ {result.invoice_ids.length} invoice{result.invoice_ids.length !== 1 ? 's' : ''} imported
          </div>
          <div style={{ color: '#166534', fontSize: '.9rem' }}>Invoice IDs: {result.invoice_ids.join(', ')}</div>
          {savePdf && file && (
            <div style={{ color: '#166534', fontSize: '.85rem', marginTop: '.35rem' }}>PDF saved to cloud storage.</div>
          )}
        </div>
        {result.warnings.length > 0 && (
          <div className="card" style={{ maxWidth: 700, marginTop: '1rem', borderColor: '#fbbf24', background: '#fffbeb' }}>
            <div style={{ fontWeight: 600, color: '#92400e', marginBottom: '.5rem' }}>
              ⚠ {result.warnings.length} warning{result.warnings.length !== 1 ? 's' : ''}
            </div>
            {result.warnings.map((w, i) => (
              <div key={i} style={{ fontSize: '.85rem', color: '#92400e', padding: '.35rem 0', borderBottom: '1px solid #fde68a' }}>
                {w.message}
              </div>
            ))}
          </div>
        )}
        <button className="btn-primary" style={{ marginTop: '1.5rem' }} onClick={reset}>Import Another Invoice</button>
      </div>
    )
  }

  // ── REVIEW ────────────────────────────────────────────────────────────────
  if (step === 'review') {
    const selectedItems  = items.filter(it => it.selected)
    const selectedCount  = selectedItems.length
    const missingInvNum  = selectedItems.some(it => !it.invoice.invoice_number.trim())
    const missingLocation = selectedItems.some(it =>
      it.invoice.line_items.some(l => !l.location_id)
    )

    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
          <div>
            <h1 style={{ margin: 0 }}>Review Invoices</h1>
            <p style={{ color: '#6b7280', margin: '.25rem 0 0', fontSize: '.9rem' }}>
              {items.length} invoice{items.length !== 1 ? 's' : ''} · {selectedCount} selected for import
            </p>
          </div>
          <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center' }}>
            <button className="btn-secondary" onClick={reset}>← Start Over</button>
            <div>
              <button
                className="btn-primary"
                disabled={selectedCount === 0 || missingInvNum || missingLocation}
                onClick={() => setShowConfirm(true)}
              >
                Import {selectedCount > 0 ? `${selectedCount} Invoice${selectedCount !== 1 ? 's' : ''}` : ''}
              </button>
              {missingInvNum && (
                <div style={{ fontSize: '.75rem', color: '#b91c1c', marginTop: '.2rem', textAlign: 'right' }}>
                  Invoice number required
                </div>
              )}
              {!missingInvNum && missingLocation && (
                <div style={{ fontSize: '.75rem', color: '#b91c1c', marginTop: '.2rem', textAlign: 'right' }}>
                  Location required for all lines
                </div>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '.5rem', padding: '.75rem 1rem', marginBottom: '1rem', color: '#b91c1c' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {items.map((it, i) => {
            const dup = it.dupCheck?.duplicate
            const isCredit = it.invoice.invoice_type === 'credit_note'
            const invNumMissing = it.selected && !it.invoice.invoice_number.trim()
            const locMissing = it.selected && it.invoice.line_items.some(l => !l.location_id)
            const hasError = invNumMissing || locMissing
            return (
              <div key={i} className="card" style={{
                borderColor: hasError ? '#fca5a5' : dup ? '#fca5a5' : it.selected ? '#86efac' : '#e5e7eb',
                opacity: it.selected ? 1 : 0.6,
              }}>
                {/* Header row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  <input type="checkbox" checked={it.selected} onChange={() => toggle(i, 'selected')}
                    style={{ width: 18, height: 18, cursor: 'pointer', flexShrink: 0 }} />

                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: '1rem' }}>
                        {it.invoice.supplier.trade_name || it.invoice.supplier.name || '(no supplier)'}
                      </span>
                      {isCredit && (
                        <span style={{ background: '#fef9c3', border: '1px solid #fbbf24', color: '#92400e', fontSize: '.72rem', fontWeight: 700, padding: '2px 7px', borderRadius: 4, letterSpacing: '.04em' }}>
                          CREDIT NOTE
                        </span>
                      )}
                      <span style={{ color: invNumMissing ? '#b91c1c' : '#6b7280', fontSize: '.85rem', fontWeight: invNumMissing ? 600 : 400 }}>
                        {invNumMissing ? '⚠ Invoice # required' : `Invoice #${it.invoice.invoice_number || '—'}`}
                      </span>
                      <span style={{ color: '#6b7280', fontSize: '.85rem' }}>{it.invoice.invoice_date}</span>
                      {it.invoice.supplier.vat_number && (
                        <span style={{ color: '#9ca3af', fontSize: '.8rem' }}>VAT: {it.invoice.supplier.vat_number}</span>
                      )}
                    </div>
                  </div>

                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontWeight: 700 }}>€{eur(it.invoice.gross_amount)}</div>
                    <div style={{ fontSize: '.75rem', color: '#6b7280' }}>
                      Net €{eur(it.invoice.net_amount)} · VAT €{eur(it.invoice.vat_amount)}
                    </div>
                  </div>

                  {dup && (
                    <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '.375rem', padding: '.35rem .75rem', fontSize: '.8rem', color: '#b91c1c', flexShrink: 0 }}>
                      ⚠ Duplicate — already imported on {it.dupCheck!.existing?.invoice_date}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '.5rem', flexShrink: 0 }}>
                    <button className={it.supplierOpen ? 'btn-primary' : 'btn-secondary'}
                      style={{ fontSize: '.8rem', padding: '4px 10px' }} onClick={() => toggle(i, 'supplierOpen')}>
                      {it.supplierOpen ? 'Hide details' : 'Edit details'}
                    </button>
                    <button className="btn-secondary" style={{ fontSize: '.8rem', padding: '4px 10px' }} onClick={() => toggle(i, 'expanded')}>
                      {it.expanded ? 'Hide lines' : `Lines (${it.invoice.line_items.length})`}
                    </button>
                  </div>
                </div>

                {/* Location row — always visible, mandatory */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginTop: '.6rem', padding: '.5rem .65rem', background: locMissing ? '#fef2f2' : '#f8fafc', borderRadius: 6, border: `1px solid ${locMissing ? '#fca5a5' : '#e5e7eb'}` }}>
                  <span style={{ fontSize: '.78rem', fontWeight: 700, color: locMissing ? '#b91c1c' : '#374151', flexShrink: 0 }}>
                    {locMissing ? '⚠ ' : ''}{isCredit ? 'Return from location *' : 'Receive into location *'}
                  </span>
                  <select
                    value={it.defaultLocationId ?? ''}
                    onChange={e => setDefaultLocation(i, Number(e.target.value) || null)}
                    style={{ borderColor: locMissing ? '#fca5a5' : undefined, minWidth: 160 }}
                  >
                    <option value="">— select location —</option>
                    {(locations ?? []).filter(l => l.is_active).map(l => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                  {it.invoice.line_items.length > 0 && (
                    <button
                      className="btn-secondary"
                      style={{ fontSize: '.75rem', padding: '3px 9px', flexShrink: 0 }}
                      disabled={suggestingIdx === i}
                      onClick={() => handleSuggest(i)}
                    >
                      {suggestingIdx === i ? 'Suggesting…' : 'Suggest from inventory'}
                    </button>
                  )}
                  {it.defaultLocationId && (
                    <span style={{ fontSize: '.75rem', color: '#6b7280', marginLeft: 'auto' }}>
                      All lines {isCredit ? 'from' : '→'} {(locations ?? []).find(l => l.id === it.defaultLocationId)?.name}
                      {it.invoice.line_items.some(l => l.location_id !== it.defaultLocationId) && ' (some overridden)'}
                    </span>
                  )}
                </div>

                {/* Details panel */}
                {it.supplierOpen && (
                  <div style={{ marginTop: '.75rem', padding: '.85rem 1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e5e7eb' }}>

                    {/* Invoice metadata */}
                    <div style={{ marginBottom: '.75rem' }}>
                      <div style={{ fontSize: '.75rem', fontWeight: 600, color: '#4f46e5', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: '.3rem' }}>Invoice details</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.6rem' }}>
                        <label style={{ gridColumn: 'span 2' }}>
                          <div style={{ fontSize: '.75rem', color: '#6b7280', marginBottom: '.2rem' }}>Document Type</div>
                          <select
                            value={it.invoice.invoice_type}
                            onChange={e => patchInvoiceMeta(i, { invoice_type: e.target.value })}
                            style={{ maxWidth: 260 }}
                          >
                            <option value="invoice">Invoice (Τιμολόγιο)</option>
                            <option value="credit_note">Credit Note (Πιστωτικό Τιμολόγιο)</option>
                          </select>
                        </label>
                        <label>
                          <div style={{ fontSize: '.75rem', color: invNumMissing ? '#b91c1c' : '#6b7280', marginBottom: '.2rem', fontWeight: invNumMissing ? 600 : 400 }}>
                            Invoice Number *
                          </div>
                          <input
                            value={it.invoice.invoice_number}
                            onChange={e => patchInvoiceMeta(i, { invoice_number: e.target.value })}
                            onBlur={e => recheckDup(i, it.invoice.supplier.vat_number ?? '', e.target.value)}
                            style={{ fontFamily: 'monospace', borderColor: invNumMissing ? '#fca5a5' : undefined }}
                          />
                        </label>
                        <label>
                          <div style={{ fontSize: '.75rem', color: '#6b7280', marginBottom: '.2rem' }}>Invoice Date</div>
                          <input type="date" value={it.invoice.invoice_date}
                            onChange={e => patchInvoiceMeta(i, { invoice_date: e.target.value })} />
                        </label>
                        <label>
                          <div style={{ fontSize: '.75rem', color: '#6b7280', marginBottom: '.2rem' }}>Net Amount (€)</div>
                          <input type="number" step="0.01" value={it.invoice.net_amount}
                            onChange={e => patchInvoiceMeta(i, { net_amount: toNumber(e.target.value) })} />
                        </label>
                        <label>
                          <div style={{ fontSize: '.75rem', color: '#6b7280', marginBottom: '.2rem' }}>VAT Amount (€)</div>
                          <input type="number" step="0.01" value={it.invoice.vat_amount}
                            onChange={e => patchInvoiceMeta(i, { vat_amount: toNumber(e.target.value) })} />
                        </label>
                        <label>
                          <div style={{ fontSize: '.75rem', color: '#6b7280', marginBottom: '.2rem' }}>Gross Amount (€)</div>
                          <input type="number" step="0.01" value={it.invoice.gross_amount}
                            onChange={e => patchInvoiceMeta(i, { gross_amount: toNumber(e.target.value) })} />
                        </label>
                      </div>
                    </div>

                    {/* Link to existing supplier */}
                    <div style={{ marginBottom: '.75rem' }}>
                      <div style={{ fontSize: '.75rem', fontWeight: 600, color: '#4f46e5', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: '.3rem' }}>
                        Link to existing supplier
                        <span style={{ fontWeight: 400, color: '#9ca3af', marginLeft: '.5rem', textTransform: 'none', letterSpacing: 0 }}>— overrides fields below</span>
                      </div>
                      <select defaultValue="" style={{ maxWidth: 420 }}
                        onChange={e => {
                          const s = (suppliers ?? []).find(s => s.id === +e.target.value)
                          if (!s) return
                          patchSupplier(i, { name: s.name, trade_name: s.trade_name, vat_number: s.vat_number })
                          recheckDup(i, s.vat_number ?? '', it.invoice.invoice_number)
                          loadSupplierProducts(i, s.id)
                        }}
                      >
                        <option value="">— use extracted data —</option>
                        {(suppliers ?? []).map(s => (
                          <option key={s.id} value={s.id}>
                            {s.trade_name || s.name}{s.vat_number ? ` (VAT: ${s.vat_number})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Supplier fields */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '.6rem' }}>
                      <label>
                        <div style={{ fontSize: '.75rem', color: '#6b7280', marginBottom: '.2rem' }}>Name</div>
                        <input value={it.invoice.supplier.name} onChange={e => patchSupplier(i, { name: e.target.value })} />
                      </label>
                      <label>
                        <div style={{ fontSize: '.75rem', color: '#6b7280', marginBottom: '.2rem' }}>Trade Name</div>
                        <input value={it.invoice.supplier.trade_name ?? ''} onChange={e => patchSupplier(i, { trade_name: e.target.value || null })} />
                      </label>
                      <label>
                        <div style={{ fontSize: '.75rem', color: '#6b7280', marginBottom: '.2rem' }}>VAT / AFM</div>
                        <input value={it.invoice.supplier.vat_number ?? ''}
                          onChange={e => patchSupplier(i, { vat_number: e.target.value || null })}
                          onBlur={e => recheckDup(i, e.target.value, it.invoice.invoice_number)} />
                      </label>
                      <label>
                        <div style={{ fontSize: '.75rem', color: '#6b7280', marginBottom: '.2rem' }}>Phone</div>
                        <input value={it.invoice.supplier.phone ?? ''} onChange={e => patchSupplier(i, { phone: e.target.value || null })} />
                      </label>
                      <label style={{ gridColumn: 'span 2' }}>
                        <div style={{ fontSize: '.75rem', color: '#6b7280', marginBottom: '.2rem' }}>Address</div>
                        <input value={it.invoice.supplier.address ?? ''} onChange={e => patchSupplier(i, { address: e.target.value || null })} />
                      </label>
                    </div>
                  </div>
                )}

                {/* Line items */}
                {it.expanded && (
                  <div style={{ marginTop: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.5rem' }}>
                      <div style={{ fontSize: '.8rem', color: '#6b7280' }}>
                        Edit product lines before import.
                        {it.supplierProducts.length > 0 && (
                          <span style={{ marginLeft: '.5rem', color: '#4f46e5', fontWeight: 500 }}>
                            · {it.supplierProducts.length} past products available — click Description to search
                          </span>
                        )}
                      </div>
                      <button className="btn-secondary" style={{ fontSize: '12px', padding: '4px 10px' }} onClick={() => addLineItem(i)}>
                        + Add Line
                      </button>
                    </div>
                    {it.invoice.line_items.length === 0 ? (
                      <div style={{ color: '#9ca3af', fontSize: '13px', padding: '.5rem 0' }}>No lines yet — click "+ Add Line" above.</div>
                    ) : (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ minWidth: 900 }}>
                          <thead>
                            <tr>
                              <th>Description</th><th>SKU</th><th>Qty</th><th>Unit</th>
                              <th style={{ color: '#b91c1c' }}>Location *</th>
                              <th>Unit Price</th><th>Disc%</th><th>VAT%</th><th>Net</th><th>Gross</th><th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {it.invoice.line_items.map((line, j) => {
                              const lkey = `${i}_${j}`
                              const isOpen = !!lineSearchOpen[lkey]
                              const searchTerm = lineSearchText[lkey] ?? ''
                              const hits = it.supplierProducts.filter(p =>
                                !searchTerm ||
                                p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                (p.supplier_sku ?? '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                                (p.supplier_product_name ?? '').toLowerCase().includes(searchTerm.toLowerCase())
                              ).slice(0, 30)
                              return (
                                <tr key={j}>
                                  <td>
                                    {it.supplierProducts.length > 0 ? (
                                      <div style={{ position: 'relative' }}>
                                        <input
                                          value={isOpen ? searchTerm : line.description}
                                          placeholder="Search product…"
                                          onChange={e => setLineSearchText(s => ({ ...s, [lkey]: e.target.value }))}
                                          onFocus={e => {
                                            const rect = e.currentTarget.getBoundingClientRect()
                                            setLineDropdownPos(s => ({ ...s, [lkey]: { top: rect.bottom + 2, left: rect.left, width: Math.max(rect.width, 320) } }))
                                            setLineSearchOpen(s => ({ ...s, [lkey]: true }))
                                            setLineSearchText(s => ({ ...s, [lkey]: line.description }))
                                          }}
                                          onBlur={() => setTimeout(() => {
                                            const typed = lineSearchText[lkey]
                                            if (typed !== undefined) patchLineItem(i, j, { description: typed })
                                            setLineSearchOpen(s => { const n = { ...s }; delete n[lkey]; return n })
                                            setLineSearchText(s => { const n = { ...s }; delete n[lkey]; return n })
                                          }, 160)}
                                          style={{ minWidth: 200 }}
                                        />
                                        {isOpen && lineDropdownPos[lkey] && (
                                          <div style={{
                                            position: 'fixed',
                                            top:   lineDropdownPos[lkey].top,
                                            left:  lineDropdownPos[lkey].left,
                                            width: lineDropdownPos[lkey].width,
                                            zIndex: 1000,
                                            background: '#fff', border: '1px solid #e5e7eb', borderRadius: '6px',
                                            boxShadow: '0 4px 12px rgba(0,0,0,.15)', maxHeight: 220, overflowY: 'auto',
                                          }}>
                                            {hits.length === 0 ? (
                                              <div style={{ padding: '6px 10px', color: '#9ca3af', fontSize: '13px' }}>No matching products</div>
                                            ) : hits.map(p => (
                                              <div key={p.supplier_product_id} onMouseDown={() => selectSupplierProduct(i, j, p)}
                                                style={{ padding: '6px 10px', cursor: 'pointer', fontSize: '13px', borderBottom: '1px solid #f3f4f6' }}>
                                                <div style={{ fontWeight: 500 }}>{p.name}</div>
                                                <div style={{ fontSize: '11px', color: '#6b7280' }}>
                                                  {p.supplier_product_name && p.supplier_product_name !== p.name && (
                                                    <span style={{ color: '#4f46e5' }}>alias: {p.supplier_product_name} · </span>
                                                  )}
                                                  {p.supplier_sku && <span>SKU: {p.supplier_sku} · </span>}
                                                  {p.current_price != null && <span>€{p.current_price}</span>}
                                                  {p.unit && <span> / {p.unit}</span>}
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      <input value={line.description} onChange={e => patchLineItem(i, j, { description: e.target.value })} style={{ minWidth: 200 }} />
                                    )}
                                  </td>
                                  <td>
                                    <input value={line.supplier_sku ?? ''} placeholder="—"
                                      onChange={e => patchLineItem(i, j, { supplier_sku: e.target.value || null })}
                                      style={{ width: 110, fontFamily: 'monospace' }} />
                                  </td>
                                  <td>
                                    <input type="number" step="0.01" value={line.quantity}
                                      onChange={e => patchLineItem(i, j, calcLine(line, { quantity: toNumber(e.target.value, line.quantity) }))}
                                      style={{ width: 72 }} />
                                  </td>
                                  <td>
                                    <select value={line.unit} onChange={e => patchLineItem(i, j, { unit: e.target.value })} style={{ width: 80 }}>
                                      <option value="">—</option>
                                      {(units ?? []).map(u => (
                                        <option key={u.id} value={u.abbreviation}>{u.abbreviation} — {u.name}</option>
                                      ))}
                                      {line.unit && !(units ?? []).some(u => u.abbreviation === line.unit) && (
                                        <option value={line.unit}>{line.unit}</option>
                                      )}
                                    </select>
                                  </td>
                                  <td>
                                    <select
                                      value={line.location_id ?? ''}
                                      onChange={e => patchLineItem(i, j, { location_id: Number(e.target.value) || null })}
                                      style={{ width: 110, borderColor: !line.location_id ? '#fca5a5' : undefined }}
                                    >
                                      <option value="">— required —</option>
                                      {(locations ?? []).filter(l => l.is_active).map(l => (
                                        <option key={l.id} value={l.id}>{l.name}</option>
                                      ))}
                                    </select>
                                  </td>
                                  <td>
                                    <input type="number" step="0.0001" value={line.unit_price}
                                      onChange={e => patchLineItem(i, j, calcLine(line, { unit_price: toNumber(e.target.value, line.unit_price) }))}
                                      style={{ width: 88 }} />
                                  </td>
                                  <td>
                                    <input type="number" step="0.01" value={line.discount_percent}
                                      onChange={e => patchLineItem(i, j, calcLine(line, { discount_percent: toNumber(e.target.value, line.discount_percent) }))}
                                      style={{ width: 64 }} />
                                  </td>
                                  <td>
                                    <input type="number" step="0.01" value={line.vat_rate}
                                      onChange={e => patchLineItem(i, j, calcLine(line, { vat_rate: toNumber(e.target.value, line.vat_rate) }))}
                                      style={{ width: 64 }} />
                                  </td>
                                  <td>
                                    <input type="number" step="0.01" value={line.line_net_amount}
                                      onChange={e => patchLineItem(i, j, { line_net_amount: toNumber(e.target.value, line.line_net_amount) })}
                                      style={{ width: 88 }} />
                                  </td>
                                  <td>
                                    <input type="number" step="0.01" value={line.line_gross_amount}
                                      onChange={e => patchLineItem(i, j, { line_gross_amount: toNumber(e.target.value, line.line_gross_amount) })}
                                      style={{ width: 88 }} />
                                  </td>
                                  <td>
                                    <button className="btn-danger" style={{ padding: '3px 7px', fontSize: '11px' }}
                                      onClick={() => removeLineItem(i, j)}>✕</button>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div style={{ marginTop: '1.5rem', display: 'flex', gap: '.75rem', justifyContent: 'flex-end', alignItems: 'center' }}>
          {missingInvNum && (
            <span style={{ color: '#b91c1c', fontSize: '.85rem' }}>Invoice number required on all selected invoices</span>
          )}
          {!missingInvNum && missingLocation && (
            <span style={{ color: '#b91c1c', fontSize: '.85rem' }}>All line items must have a location</span>
          )}
          <button className="btn-secondary" onClick={reset}>← Start Over</button>
          <button className="btn-primary" disabled={selectedCount === 0 || missingInvNum || missingLocation} onClick={() => setShowConfirm(true)}>
            Import {selectedCount > 0 ? `${selectedCount} Invoice${selectedCount !== 1 ? 's' : ''}` : ''}
          </button>
        </div>

        {/* ── Confirmation modal ───────────────────────────────────────────── */}
        {showConfirm && (
          <>
            <div onClick={() => setShowConfirm(false)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 60 }} />
            <div style={{
              position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
              background: '#fff', borderRadius: '.75rem', zIndex: 70,
              width: '90%', maxWidth: 580, boxShadow: '0 20px 60px rgba(0,0,0,.25)',
            }}>
              <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e5e7eb', fontWeight: 700, fontSize: '1.1rem' }}>
                Confirm Import
              </div>
              <div style={{ padding: '1.25rem 1.5rem' }}>
                <p style={{ margin: '0 0 1rem', color: '#374151', fontSize: '.95rem' }}>
                  You are about to import <strong>{selectedCount} invoice{selectedCount !== 1 ? 's' : ''}</strong> into the database.
                  This will create stock movements and cannot be undone.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem', maxHeight: 280, overflowY: 'auto' }}>
                  {selectedItems.map((it, idx) => (
                    <div key={idx} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '.5rem .75rem', background: '#f9fafb', borderRadius: '6px', fontSize: '.9rem',
                    }}>
                      <div>
                        <span style={{ fontWeight: 600 }}>
                          {it.invoice.supplier.trade_name || it.invoice.supplier.name || '(no supplier)'}
                        </span>
                        <span style={{ color: '#6b7280', marginLeft: '.5rem' }}>#{it.invoice.invoice_number}</span>
                        <span style={{ color: '#9ca3af', marginLeft: '.5rem', fontSize: '.8rem' }}>{it.invoice.invoice_date}</span>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontWeight: 700 }}>€{eur(it.invoice.gross_amount)}</div>
                        <div style={{ fontSize: '.75rem', color: '#6b7280' }}>
                          {it.invoice.line_items.length} line{it.invoice.line_items.length !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid #e5e7eb', display: 'flex', gap: '.75rem', justifyContent: 'flex-end' }}>
                <button className="btn-secondary" onClick={() => setShowConfirm(false)}>Cancel</button>
                <button className="btn-primary" onClick={handleImport}>Confirm Import</button>
              </div>
            </div>
          </>
        )}
      </div>
    )
  }

  // ── EXTRACTING / IMPORTING ─────────────────────────────────────────────────
  if (step === 'extracting' || step === 'importing') {
    const msg = step === 'extracting' ? 'Sending PDF to Gemini for extraction…' : 'Importing invoices into the database…'
    return (
      <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
        <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>{step === 'extracting' ? '🔍' : '💾'}</div>
        <div style={{ fontWeight: 600, fontSize: '1.1rem', marginBottom: '.5rem' }}>{msg}</div>
        <div style={{ color: '#6b7280', fontSize: '.9rem' }}>This may take a few seconds…</div>
      </div>
    )
  }

  // ── UPLOAD ────────────────────────────────────────────────────────────────
  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Import Invoice</h1>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', maxWidth: 860 }}>
        <div>
          <h3 style={{ marginTop: 0 }}>1. Select PDF</h3>
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
            style={{
              border: `2px dashed ${file ? '#6ee7b7' : '#d1d5db'}`, borderRadius: '12px',
              padding: '3rem 1.5rem', textAlign: 'center', cursor: 'pointer',
              background: file ? '#f0fdf4' : '#fafbff', transition: 'all .2s',
            }}
          >
            {file ? (
              <>
                <div style={{ fontSize: '1.5rem', marginBottom: '.5rem' }}>📄</div>
                <div style={{ fontWeight: 600 }}>{file.name}</div>
                <div style={{ color: '#6b7280', fontSize: '.8rem', marginTop: '.25rem' }}>{(file.size / 1024).toFixed(1)} KB</div>
                <div style={{ color: '#16a34a', fontSize: '.85rem', marginTop: '.5rem' }}>✓ Ready</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: '2rem', marginBottom: '.5rem' }}>📁</div>
                <div style={{ fontWeight: 500 }}>Drop PDF here or click to browse</div>
                <div style={{ color: '#9ca3af', fontSize: '.8rem', marginTop: '.25rem' }}>Supports single and multi-invoice PDFs</div>
              </>
            )}
          </div>
          <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
          {file && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginTop: '.75rem', cursor: 'pointer', fontSize: '.9rem' }}>
              <input type="checkbox" checked={savePdf} onChange={e => setSavePdf(e.target.checked)} />
              Save PDF to cloud storage after import
            </label>
          )}
        </div>

        <div>
          <h3 style={{ marginTop: 0 }}>2. AI Model</h3>
          <div>
            <div style={{ fontSize: '.8rem', marginBottom: '.35rem', fontWeight: 500 }}>Model</div>
            <select value={model} onChange={e => setModel(e.target.value)}>
              {geminiModels.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          {providers && !providers.gemini.available && (
            <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '.4rem', padding: '.6rem .9rem', fontSize: '.8rem', color: '#92400e', marginTop: '1rem' }}>
              No API key configured. Add <code>GOOGLE_API_KEY</code> to the server environment to use Gemini.
            </div>
          )}
        </div>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '.5rem', padding: '.75rem 1rem', marginTop: '1rem', maxWidth: 500, color: '#b91c1c' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', alignItems: 'center' }}>
        <button className="btn-primary" style={{ padding: '.6rem 2rem', fontSize: '1rem' }}
          disabled={!file || (providers != null && !providers.gemini.available)} onClick={handleExtract}>
          Extract Invoice Data →
        </button>
        <span style={{ color: '#9ca3af', fontSize: '.9rem' }}>or</span>
        <button className="btn-secondary" style={{ padding: '.6rem 1.5rem', fontSize: '1rem' }} onClick={handleManual}>
          Enter Manually
        </button>
      </div>
    </div>
  )
}
