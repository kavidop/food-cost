import { useState } from 'react'
import { getServiceLines, getProductReferenceData, getSuppliers } from '@/api/client'
import { useQuery } from '@/hooks/useAsync'
import Spinner from '@/components/Spinner'
import type { ServiceLineOut } from '@/types/api'

const eur = (n: number) =>
  n.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

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

export default function Services() {
  const [categoryId, setCategoryId] = useState<number | ''>('')
  const [supplierId, setSupplierId] = useState<number | ''>('')
  const [dateFrom,   setDateFrom]   = useState('')
  const [dateTo,     setDateTo]     = useState('')
  const [search,     setSearch]     = useState('')

  const { data: refData }   = useQuery(getProductReferenceData)
  const { data: suppliers } = useQuery(getSuppliers)

  const { data, loading, error } = useQuery(
    () => getServiceLines({
      category_id: categoryId || undefined,
      supplier_id: supplierId || undefined,
      date_from:   dateFrom || undefined,
      date_to:     dateTo   || undefined,
    }),
    [categoryId, supplierId, dateFrom, dateTo],
  )

  const serviceCategories = (refData?.categories ?? []).filter(c => c.is_service)
  const allRows: ServiceLineOut[] = data ?? []

  const rows = search.trim()
    ? allRows.filter(r =>
        r.service_name.toLowerCase().includes(search.toLowerCase()) ||
        r.supplier_name.toLowerCase().includes(search.toLowerCase()) ||
        r.invoice_number.toLowerCase().includes(search.toLowerCase())
      )
    : allRows

  // Summary stats
  const totalGross = rows.reduce((s, r) => {
    const sign = r.invoice_type === 'credit_note' ? -1 : 1
    return s + sign * r.line_gross_amount
  }, 0)
  const totalNet = rows.reduce((s, r) => {
    const sign = r.invoice_type === 'credit_note' ? -1 : 1
    return s + sign * r.line_net_amount
  }, 0)
  const categoryCount = new Set(rows.map(r => r.category_id)).size

  // Group by category for the summary breakdown
  const byCategory = new Map<string, number>()
  rows.forEach(r => {
    const sign = r.invoice_type === 'credit_note' ? -1 : 1
    byCategory.set(r.category_name, (byCategory.get(r.category_name) ?? 0) + sign * r.line_gross_amount)
  })

  const th: React.CSSProperties = {
    padding: '.5rem .75rem', textAlign: 'left', fontSize: '.72rem',
    fontWeight: 700, color: '#6b7280', textTransform: 'uppercase',
    letterSpacing: '.05em', borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap',
  }
  const td: React.CSSProperties = {
    padding: '.55rem .75rem', fontSize: '.85rem', color: '#374151',
    borderBottom: '1px solid #f3f4f6', verticalAlign: 'middle',
  }

  if (loading && !data) return <Spinner />
  if (error) return <p style={{ color: '#dc2626' }}>{error}</p>

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700, color: '#111827' }}>
            Services &amp; Guarantees
          </h1>
          <p style={{ margin: '.2rem 0 0', color: '#6b7280', fontSize: '.85rem' }}>
            Non-inventory invoice lines — services, fees, guarantees
          </p>
        </div>
        {serviceCategories.length === 0 && (
          <div style={{
            padding: '.6rem 1rem', background: '#fffbeb', border: '1px solid #fde68a',
            borderRadius: 8, fontSize: '.82rem', color: '#92400e', maxWidth: 340,
          }}>
            No service categories defined yet. Go to <strong>Categories</strong> and mark a category as "Service".
          </div>
        )}
      </div>

      {/* Filters */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '.75rem', alignItems: 'center',
        padding: '.75rem 1rem', background: '#f9fafb', border: '1px solid #e5e7eb',
        borderRadius: 8, marginBottom: '1rem',
      }}>
        <input
          type="text"
          placeholder="Search…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ padding: '.35rem .6rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '.85rem', width: 180 }}
        />

        <select
          value={categoryId}
          onChange={e => setCategoryId(e.target.value === '' ? '' : Number(e.target.value))}
          style={{ padding: '.35rem .6rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '.85rem' }}
        >
          <option value="">All service categories</option>
          {serviceCategories.sort((a, b) => a.name.localeCompare(b.name)).map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <select
          value={supplierId}
          onChange={e => setSupplierId(e.target.value === '' ? '' : Number(e.target.value))}
          style={{ padding: '.35rem .6rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '.85rem' }}
        >
          <option value="">All suppliers</option>
          {(suppliers ?? []).map(s => (
            <option key={s.id} value={s.id}>{s.trade_name ?? s.name}</option>
          ))}
        </select>

        <input
          type="date"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          title="From date"
          style={{ padding: '.35rem .6rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '.85rem' }}
        />
        <input
          type="date"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          title="To date"
          style={{ padding: '.35rem .6rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '.85rem' }}
        />

        {(dateFrom || dateTo || categoryId || supplierId || search) && (
          <button
            onClick={() => { setSearch(''); setCategoryId(''); setSupplierId(''); setDateFrom(''); setDateTo('') }}
            style={{
              padding: '.35rem .65rem', background: 'white', border: '1px solid #d1d5db',
              borderRadius: 6, fontSize: '.8rem', cursor: 'pointer', color: '#374151',
            }}
          >
            Clear
          </button>
        )}

        <span style={{ fontSize: '.8rem', color: '#9ca3af', marginLeft: 'auto' }}>
          {loading ? 'Loading…' : `${rows.length} line${rows.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Summary tiles */}
      <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <Tile label="Total (gross)"  value={`€${eur(totalGross)}`} />
        <Tile label="Total (net)"    value={`€${eur(totalNet)}`} />
        <Tile label="Lines"          value={rows.length} />
        <Tile label="Categories"     value={categoryCount} />
      </div>

      {/* Category breakdown */}
      {byCategory.size > 1 && (
        <div style={{
          display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '1rem',
        }}>
          {[...byCategory.entries()].sort((a, b) => b[1] - a[1]).map(([name, total]) => (
            <div key={name} style={{
              padding: '.4rem .8rem', background: '#f3e8ff', border: '1px solid #d8b4fe',
              borderRadius: 6, fontSize: '.82rem',
            }}>
              <span style={{ fontWeight: 600, color: '#6b21a8' }}>{name}</span>
              <span style={{ color: '#7c3aed', marginLeft: '.4rem' }}>€{eur(total)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      {rows.length === 0 ? (
        <p style={{ color: '#6b7280', padding: '2rem 0', textAlign: 'center' }}>
          {allRows.length === 0 ? 'No service lines recorded yet.' : 'No lines match the current filters.'}
        </p>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
            <thead style={{ background: '#f9fafb' }}>
              <tr>
                <th style={th}>Date</th>
                <th style={th}>Invoice</th>
                <th style={th}>Supplier</th>
                <th style={th}>Service / Item</th>
                <th style={th}>Category</th>
                <th style={{ ...th, textAlign: 'right' }}>Qty</th>
                <th style={{ ...th, textAlign: 'right' }}>Unit Price</th>
                <th style={{ ...th, textAlign: 'right' }}>Net</th>
                <th style={{ ...th, textAlign: 'right' }}>Gross</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const isCreditNote = row.invoice_type === 'credit_note'
                const sign = isCreditNote ? -1 : 1
                return (
                  <tr
                    key={row.invoice_line_id}
                    style={{ background: isCreditNote ? '#fdf2f8' : 'white' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f5f3ff')}
                    onMouseLeave={e => (e.currentTarget.style.background = isCreditNote ? '#fdf2f8' : 'white')}
                  >
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{row.invoice_date}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      {row.invoice_number}
                      {isCreditNote && (
                        <span style={{
                          marginLeft: 6, fontSize: '.68rem', fontWeight: 600,
                          background: '#fce7f3', color: '#be185d',
                          padding: '.1rem .4rem', borderRadius: 9999,
                        }}>CN</span>
                      )}
                    </td>
                    <td style={td}>{row.supplier_name}</td>
                    <td style={{ ...td, fontWeight: 500 }}>{row.service_name}</td>
                    <td style={td}>
                      <span style={{
                        padding: '.15rem .5rem', background: '#f3e8ff', color: '#6b21a8',
                        borderRadius: 9999, fontSize: '.75rem', fontWeight: 600,
                      }}>
                        {row.category_name}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>{row.quantity}</td>
                    <td style={{ ...td, textAlign: 'right' }}>€{eur(row.unit_price)}</td>
                    <td style={{ ...td, textAlign: 'right', color: isCreditNote ? '#be185d' : '#374151' }}>
                      {isCreditNote ? '-' : ''}€{eur(Math.abs(sign * row.line_net_amount))}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: isCreditNote ? '#be185d' : '#111827' }}>
                      {isCreditNote ? '-' : ''}€{eur(Math.abs(sign * row.line_gross_amount))}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
