import { getDashboard, getServiceLines } from '@/api/client'
import { useQuery }     from '@/hooks/useAsync'
import Spinner          from '@/components/Spinner'

const eur = (n: number) =>
  n.toLocaleString('el-GR', { style: 'currency', currency: 'EUR' })

const qty = (n: number, unit: string | null) =>
  `${n % 1 === 0 ? n : n.toFixed(2)} ${unit ?? ''}`

const STATUS_TONE = {
  low_stock:    { bg: '#fef3c7', color: '#92400e', label: 'Low stock' },
  out_of_stock: { bg: '#fee2e2', color: '#991b1b', label: 'Out of stock' },
  negative:     { bg: '#f3e8ff', color: '#6b21a8', label: 'Negative' },
  ok:           { bg: '#d1fae5', color: '#065f46', label: 'OK' },
} as const

function StatCard({ label, value, hint, accent }: { label: string; value: string | number; hint?: string; accent?: string }) {
  return (
    <div className="card" style={{ padding: '1rem 1.1rem' }}>
      <div style={{ fontSize: '.74rem', color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: '1.55rem', fontWeight: 800, color: accent ?? '#111827', marginTop: '.25rem' }}>{value}</div>
      {hint && <div style={{ color: '#6b7280', fontSize: '.8rem', marginTop: '.2rem' }}>{hint}</div>}
    </div>
  )
}

function SectionTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: '.75rem' }}>
      <h3 style={{ margin: 0 }}>{title}</h3>
      {sub && <div style={{ color: '#6b7280', fontSize: '.82rem', marginTop: '.15rem' }}>{sub}</div>}
    </div>
  )
}

export default function Dashboard() {
  const { data, loading, error } = useQuery(getDashboard)
  const { data: serviceLines }   = useQuery(getServiceLines)

  if (loading) return <Spinner />
  if (error)   return <p style={{ color: 'red' }}>{error}</p>
  if (!data)   return null

  const totalServicesSpend = (serviceLines ?? []).reduce((s, r) => {
    const sign = r.invoice_type === 'credit_note' ? -1 : 1
    return s + sign * r.line_gross_amount
  }, 0)

  const {
    stats,
    recent_invoices,
    by_supplier,
    by_category,
    by_main_category,
    inventory_alerts,
    waste_hotspots,
    recipe_watchlist,
    purchasing_snapshot,
  } = data

  return (
    <div>
      <div style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ marginTop: 0, marginBottom: '.2rem' }}>Overview</h1>
        <p style={{ color: '#6b7280', margin: 0 }}>Food cost, stock health, purchasing, and recipe readiness in one place.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
        <StatCard label="Total Spend" value={eur(stats.total_spend)} hint={`${stats.invoices} invoices`} />
        <StatCard label="Stock Value" value={eur(stats.stock_value)} hint={`${stats.products} active products`} />
        <StatCard label="Waste 30 Days" value={eur(stats.waste_value_30d)} hint={`${stats.waste_events_30d} waste events`} accent={stats.waste_value_30d > 0 ? '#b91c1c' : undefined} />
        <StatCard label="Services & Fees" value={eur(totalServicesSpend)} hint="non-inventory spend" accent="#6b21a8" />
        <StatCard label="Recipes" value={stats.recipes} hint={stats.avg_recipe_margin_pct != null ? `${stats.avg_recipe_margin_pct}% avg margin` : 'No recipe margins yet'} />
        <StatCard label="Low Stock" value={stats.low_stock_products} hint={`${stats.out_of_stock_products} out, ${stats.negative_stock_products} negative`} accent={stats.low_stock_products > 0 || stats.out_of_stock_products > 0 ? '#d97706' : undefined} />
        <StatCard label="Recipe Risk" value={stats.blocked_recipes} hint={`${stats.draft_transfers} draft transfers`} accent={stats.blocked_recipes > 0 ? '#7c3aed' : undefined} />
      </div>

      {/* ── Category breakdown ──────────────────────────────────────── */}
      {by_main_category.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${by_main_category.length}, 1fr)`, gap: '1rem', marginBottom: '1.25rem' }}>
          {by_main_category.map(cat => (
            <div key={cat.id} className="card" style={{ padding: '1rem 1.1rem' }}>
              <div style={{ fontSize: '.8rem', fontWeight: 700, color: '#4f46e5', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '.6rem' }}>
                {cat.name}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.4rem .75rem' }}>
                {[
                  { l: 'Products',   v: cat.product_count },
                  { l: 'Stock Value', v: eur(cat.stock_value) },
                  { l: 'Total Spend', v: eur(cat.total_spend) },
                  { l: 'Alerts',
                    v: cat.out_of_stock > 0 || cat.low_stock > 0
                      ? `${cat.out_of_stock} out · ${cat.low_stock} low`
                      : 'None',
                    accent: cat.out_of_stock > 0 ? '#dc2626' : cat.low_stock > 0 ? '#d97706' : '#6b7280',
                  },
                ].map(row => (
                  <div key={row.l}>
                    <div style={{ fontSize: '.68rem', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em' }}>{row.l}</div>
                    <div style={{ fontSize: '.92rem', fontWeight: 700, color: row.accent ?? '#111827', marginTop: 1 }}>{row.v}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr .8fr', gap: '1.25rem', marginBottom: '1.25rem' }}>
        <div className="card">
          <SectionTitle title="Purchasing Snapshot" sub="Recent invoice activity and supplier spend" />
          <table>
            <thead><tr><th>Invoice #</th><th>Date</th><th>Supplier</th><th>Amount</th></tr></thead>
            <tbody>
              {recent_invoices.map(i => (
                <tr key={i.id}>
                  <td>{i.invoice_number}</td>
                  <td>{i.invoice_date}</td>
                  <td>{i.supplier_name}</td>
                  <td>{eur(i.gross_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <SectionTitle title="Top Suppliers" sub="Highest total spend so far" />
          <table>
            <thead><tr><th>Supplier</th><th>Invoices</th><th>Total</th></tr></thead>
            <tbody>
              {by_supplier.slice(0, 8).map((s, i) => (
                <tr key={i}>
                  <td>{s.name}</td>
                  <td>{s.invoices}</td>
                  <td>{eur(s.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '1.25rem' }}>
        <div className="card">
          <SectionTitle title="Inventory Alerts" sub="Products needing attention right now" />
          {inventory_alerts.length === 0 ? (
            <p style={{ color: '#6b7280', margin: 0 }}>No stock alerts at the moment.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
              {inventory_alerts.map(item => {
                const tone = STATUS_TONE[item.stock_status]
                return (
                  <div key={item.product_id} style={{ display: 'flex', justifyContent: 'space-between', gap: '.75rem', paddingBottom: '.6rem', borderBottom: '1px solid #f3f4f6' }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{item.product_name}</div>
                      <div style={{ color: '#6b7280', fontSize: '.8rem' }}>
                        On hand {qty(item.on_hand_qty, item.unit)}{item.min_stock_level != null ? ` · Min ${qty(item.min_stock_level, item.unit)}` : ''}
                      </div>
                    </div>
                    <span style={{ alignSelf: 'center', background: tone.bg, color: tone.color, padding: '.18rem .55rem', borderRadius: 9999, fontSize: '.72rem', fontWeight: 700 }}>
                      {tone.label}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="card">
          <SectionTitle title="Recipe Watchlist" sub="Blocked or low-margin items" />
          {recipe_watchlist.length === 0 ? (
            <p style={{ color: '#6b7280', margin: 0 }}>No recipe risks detected.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
              {recipe_watchlist.map(recipe => (
                <div key={recipe.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '.75rem', paddingBottom: '.6rem', borderBottom: '1px solid #f3f4f6' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{recipe.name}</div>
                    <div style={{ color: '#6b7280', fontSize: '.8rem' }}>
                      Food cost {eur(recipe.total_food_cost)}{recipe.selling_price != null ? ` · Sell ${eur(recipe.selling_price)}` : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '.74rem', fontWeight: 700, color: recipe.status === 'blocked' ? '#7c3aed' : '#b45309' }}>
                      {recipe.status === 'blocked' ? 'Blocked' : 'Low margin'}
                    </div>
                    <div style={{ color: '#6b7280', fontSize: '.8rem' }}>
                      {recipe.status === 'blocked' ? `Can make ${recipe.max_producible}` : `${recipe.margin_pct ?? 0}% margin`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.25rem' }}>
        <div className="card">
          <SectionTitle title="Waste Hotspots" sub="Highest waste value in the last 30 days" />
          {waste_hotspots.length === 0 ? (
            <p style={{ color: '#6b7280', margin: 0 }}>No waste recorded in the last 30 days.</p>
          ) : (
            <table>
              <thead><tr><th>Product</th><th>Qty</th><th>Value</th></tr></thead>
              <tbody>
                {waste_hotspots.map(item => (
                  <tr key={item.product_id}>
                    <td>
                      <div>{item.product_name}</div>
                      <div style={{ color: '#6b7280', fontSize: '.78rem' }}>{item.category ?? 'Uncategorized'}</div>
                    </td>
                    <td>{qty(item.total_quantity, item.unit)}</td>
                    <td>{eur(item.total_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <SectionTitle title="Products by Subcategory" sub="Top categories by product count" />
          <table>
            <thead><tr><th>Category</th><th>Products</th></tr></thead>
            <tbody>
              {by_category.slice(0, 10).map((cat, i) => (
                <tr key={i}>
                  <td>{cat.name}</td>
                  <td>{cat.cnt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <SectionTitle title="Supplier Activity" sub="Top suppliers with latest purchasing date" />
          <table>
            <thead><tr><th>Supplier</th><th>Total</th><th>Last</th></tr></thead>
            <tbody>
              {purchasing_snapshot.map((s, i) => (
                <tr key={i}>
                  <td>
                    <div>{s.name}</div>
                    <div style={{ color: '#6b7280', fontSize: '.78rem' }}>{s.invoices} invoices</div>
                  </td>
                  <td>{eur(s.total)}</td>
                  <td>{s.last_invoice_date ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
