import { useState } from 'react'
import { getPurchasesAnalytics, getUnmatchedLines } from '@/api/client'
import { useQuery } from '@/hooks/useAsync'
import Spinner from '@/components/Spinner'
import type { PurchasePeriodRow, PurchaseCategoryBreakdown, UnmatchedLineItem } from '@/types/api'

const CAT_COLS = ['Food', 'Beverage', 'Non-Food', 'Other']
const CAT_COLORS: Record<string, string> = {
  Food:       '#16a34a',
  Beverage:   '#2563eb',
  'Non-Food': '#9333ea',
  Other:      '#6b7280',
}

const eur = (n: number) =>
  n.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function formatPeriod(period: string, granularity: string): string {
  // period comes as "YYYY-MM-DD" from DATE_TRUNC — treat as local date
  const [y, m, d] = period.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  if (granularity === 'month') {
    return date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
  }
  if (granularity === 'week') {
    const end = new Date(y, m - 1, d + 6)
    const s = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
    const e = end.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    return `${s} – ${e}`
  }
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function catData(row: PurchasePeriodRow, cat: string): PurchaseCategoryBreakdown {
  return row.by_category[cat] ?? { total_cost: 0, net_cost: 0, product_count: 0 }
}

function SummaryTile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="card" style={{ padding: '.9rem 1.1rem', minWidth: 140 }}>
      <div style={{ fontSize: '.72rem', color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: '1.45rem', fontWeight: 800, color: color ?? '#111827', marginTop: '.2rem' }}>{value}</div>
      {sub && <div style={{ fontSize: '.78rem', color: '#9ca3af', marginTop: '.15rem' }}>{sub}</div>}
    </div>
  )
}

export default function Purchases() {
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('month')
  const [months, setMonths] = useState(12)

  const { data, loading, error } = useQuery(
    () => getPurchasesAnalytics(granularity, months),
    [granularity, months],
  )
  const { data: unmatched } = useQuery(getUnmatchedLines)

  const rows: PurchasePeriodRow[] = data?.rows ?? []

  // Aggregate totals across all returned periods
  const grandTotal = rows.reduce((acc, r) => acc + r.total_cost, 0)
  const catTotals: Record<string, number> = {}
  for (const cat of CAT_COLS) {
    catTotals[cat] = rows.reduce((acc, r) => acc + catData(r, cat).total_cost, 0)
  }

  const [showUnmatched, setShowUnmatched] = useState(false)

  const btnStyle = (active: boolean) => ({
    padding: '.35rem .85rem',
    fontSize: '.82rem',
    fontWeight: active ? 700 : 400,
    border: active ? '1px solid #4f46e5' : '1px solid #d1d5db',
    background: active ? '#4f46e5' : '#fff',
    color: active ? '#fff' : '#374151',
    borderRadius: 6,
    cursor: 'pointer',
  } as React.CSSProperties)

  return (
    <div>
      <div style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ marginTop: 0, marginBottom: '.2rem' }}>Purchases</h1>
        <p style={{ color: '#6b7280', margin: 0 }}>Purchase cost and product volumes over time, broken down by category.</p>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', gap: '.35rem' }}>
          {(['day', 'week', 'month'] as const).map(g => (
            <button key={g} style={btnStyle(granularity === g)} onClick={() => setGranularity(g)}>
              {g.charAt(0).toUpperCase() + g.slice(1)}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '.35rem', marginLeft: '.5rem' }}>
          {[
            { label: '3 months',  v: 3  },
            { label: '6 months',  v: 6  },
            { label: '12 months', v: 12 },
            { label: '24 months', v: 24 },
            { label: 'All time',  v: 0  },
          ].map(opt => (
            <button key={opt.v} style={btnStyle(months === opt.v)} onClick={() => setMonths(opt.v)}>
              {opt.label}
            </button>
          ))}
        </div>
        {loading && <span style={{ fontSize: '.78rem', color: '#9ca3af' }}>loading…</span>}
      </div>

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      {/* Summary tiles */}
      {!loading && rows.length > 0 && (
        <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
          <SummaryTile label="Total Spend" value={`€${eur(grandTotal)}`} sub={`${rows.length} periods`} />
          {CAT_COLS.filter(cat => cat !== 'Other' || catTotals['Other'] > 0).map(cat => (
            <SummaryTile
              key={cat}
              label={cat}
              value={`€${eur(catTotals[cat] ?? 0)}`}
              sub={(catTotals[cat] ?? 0) > 0 ? `${Math.round(((catTotals[cat] ?? 0) / grandTotal) * 100)}% of total` : '—'}
              color={CAT_COLORS[cat]}
            />
          ))}
        </div>
      )}

      {loading && rows.length === 0 && <Spinner />}

      {!loading && rows.length === 0 && !error && (
        <p style={{ color: '#6b7280' }}>No purchase data found for the selected period.</p>
      )}

      {rows.length > 0 && (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <th rowSpan={2} style={{ ...thStyle('left'),  verticalAlign: 'middle', borderBottom: '2px solid #e5e7eb' }}>Period</th>
                <th rowSpan={2} style={{ ...thStyle('right'), verticalAlign: 'middle', borderBottom: '2px solid #e5e7eb' }}>Total Cost</th>
                <th rowSpan={2} style={{ ...thStyle('right'), verticalAlign: 'middle', borderBottom: '2px solid #e5e7eb' }}>Net Cost</th>
                {CAT_COLS.map(cat => (
                  <th key={cat} colSpan={2} style={{ ...thStyle('center'), color: CAT_COLORS[cat], borderBottom: '1px solid #e5e7eb' }}>
                    {cat}
                  </th>
                ))}
              </tr>
              <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                {CAT_COLS.flatMap(cat => [
                  <th key={`${cat}-cost`} style={{ ...thStyle('right'), fontSize: '.68rem', color: '#9ca3af' }}>Cost</th>,
                  <th key={`${cat}-qty`}  style={{ ...thStyle('right'), fontSize: '.68rem', color: '#9ca3af' }}>Products</th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={row.period} style={{ background: idx % 2 === 0 ? '#fff' : '#fafafa' }}>
                  <td style={tdStyle('left', true)}>
                    {formatPeriod(row.period, granularity)}
                  </td>
                  <td style={{ ...tdStyle('right'), fontWeight: 700 }}>
                    €{eur(row.total_cost)}
                  </td>
                  <td style={{ ...tdStyle('right'), color: '#6b7280', fontSize: '.85rem' }}>
                    €{eur(row.net_cost)}
                  </td>
                  {CAT_COLS.flatMap(cat => {
                    const cd = catData(row, cat)
                    return [
                      <td key={`${cat}-cost`} style={tdStyle('right')}>
                        {cd.total_cost > 0 ? `€${eur(cd.total_cost)}` : <span style={{ color: '#d1d5db' }}>—</span>}
                      </td>,
                      <td key={`${cat}-cnt`} style={{ ...tdStyle('right'), color: '#6b7280', fontSize: '.85rem' }}>
                        {cd.product_count > 0 ? cd.product_count : <span style={{ color: '#d1d5db' }}>—</span>}
                      </td>,
                    ]
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid #e5e7eb', background: '#f9fafb', fontWeight: 700 }}>
                <td style={tdStyle('left', true)}>Total</td>
                <td style={tdStyle('right')}>€{eur(grandTotal)}</td>
                <td style={tdStyle('right')} />
                {CAT_COLS.flatMap(cat => [
                  <td key={`${cat}-total`} style={{ ...tdStyle('right'), color: CAT_COLORS[cat] }}>
                    {catTotals[cat] > 0 ? `€${eur(catTotals[cat])}` : '—'}
                  </td>,
                  <td key={`${cat}-pct`} style={{ ...tdStyle('right'), fontSize: '.82rem', fontWeight: 400, color: '#9ca3af' }}>
                    {catTotals[cat] > 0 && grandTotal > 0
                      ? `${Math.round((catTotals[cat] / grandTotal) * 100)}%`
                      : ''}
                  </td>,
                ])}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* ── Unmatched invoice lines ─────────────────────────────────────── */}
      {unmatched && unmatched.length > 0 && (() => {
        const unmatchedTotal = unmatched.reduce((s, u) => s + u.total_gross, 0)
        return (
          <div style={{ marginTop: '1.5rem' }}>
            <button
              onClick={() => setShowUnmatched(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: '.5rem',
                background: 'none', border: 'none', cursor: 'pointer',
                padding: 0, marginBottom: '.75rem',
              }}
            >
              <span style={{ fontSize: '1rem', fontWeight: 700, color: '#111827' }}>
                Unmatched Invoice Lines
              </span>
              <span style={{
                fontSize: '.75rem', fontWeight: 700, padding: '.15rem .55rem',
                borderRadius: 9999, background: '#fef3c7', color: '#92400e',
              }}>
                {unmatched.length} lines · €{eur(unmatchedTotal)}
              </span>
              <span style={{ fontSize: '.8rem', color: '#6b7280' }}>
                {showUnmatched ? '▲ hide' : '▼ show'}
              </span>
            </button>
            <p style={{ color: '#6b7280', fontSize: '.83rem', margin: '0 0 .75rem' }}>
              Invoice lines with no product match in the catalog — these are included in Total Spend but not in any category.
            </p>
            {showUnmatched && (
              <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                      <th style={thStyle('left')}>Description</th>
                      <th style={thStyle('left')}>Supplier</th>
                      <th style={thStyle('right')}>Occurrences</th>
                      <th style={thStyle('right')}>Total Gross</th>
                      <th style={thStyle('left')}>First seen</th>
                      <th style={thStyle('left')}>Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unmatched.map((u: UnmatchedLineItem, i: number) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                        <td style={{ ...tdStyle('left'), fontWeight: 500 }}>{u.description}</td>
                        <td style={{ ...tdStyle('left'), color: '#6b7280' }}>{u.supplier_name}</td>
                        <td style={tdStyle('right')}>{u.occurrences}</td>
                        <td style={{ ...tdStyle('right'), fontWeight: 700, color: '#b45309' }}>€{eur(u.total_gross)}</td>
                        <td style={{ ...tdStyle('left'), color: '#6b7280', fontSize: '.82rem' }}>{u.first_date}</td>
                        <td style={{ ...tdStyle('left'), color: '#6b7280', fontSize: '.82rem' }}>{u.last_date}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid #e5e7eb', background: '#f9fafb', fontWeight: 700 }}>
                      <td style={tdStyle('left', true)} colSpan={3}>Total unmatched</td>
                      <td style={{ ...tdStyle('right'), color: '#b45309' }}>€{eur(unmatchedTotal)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}

function thStyle(align: 'left' | 'right' | 'center'): React.CSSProperties {
  return {
    padding: '.55rem .85rem',
    fontSize: '.72rem',
    fontWeight: 700,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '.04em',
    textAlign: align,
    whiteSpace: 'nowrap',
    borderBottom: '1px solid #e5e7eb',
  }
}

function tdStyle(align: 'left' | 'right', bold?: boolean): React.CSSProperties {
  return {
    padding: '.55rem .85rem',
    fontSize: '.88rem',
    textAlign: align,
    fontWeight: bold ? 600 : 400,
    borderBottom: '1px solid #f3f4f6',
    whiteSpace: 'nowrap',
    color: '#111827',
  }
}
