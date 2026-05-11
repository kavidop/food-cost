import { useState } from 'react'
import {
  getIntermediateProducts, getIntermediateProduct,
  createIntermediateProduct, updateIntermediateProduct,
  deleteRecipe, duplicateRecipe, archiveRecipe,
  produceIntermediateBatch, getProductionBatches,
  getAllProducts, getStockLocations,
} from '@/api/client'
import { useQuery }    from '@/hooks/useAsync'
import { useMutation } from '@/hooks/useMutation'
import Spinner         from '@/components/Spinner'
import type { RecipeDetail, ComponentOut, ProductionBatchOut } from '@/types/api'

const eur = (n: number) =>
  n.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmt = (n: number, dec = 3) => +n.toFixed(dec)

type EditComponent = {
  product_id:   number | null
  composite_id: number | null
  quantity: number
  unit: string | null
  is_composite: boolean
}

type EditState = {
  id?:               number
  name:              string
  category:          string | null
  yield_quantity:    number | null
  yield_unit:        string | null
  prep_time_minutes: number | null
  notes:             string | null
  components:        EditComponent[]
}

type ProduceState = {
  location_id:   number | ''
  batch_size:    number
  actual_yield:  number | null
  notes:         string | null
  useActualYield: boolean
}

const emptyComp = (): EditComponent => ({
  product_id: null, composite_id: null, quantity: 0, unit: null, is_composite: false,
})

const emptyEdit = (): EditState => ({
  name: '', category: null,
  yield_quantity: null, yield_unit: null,
  prep_time_minutes: null, notes: null, components: [],
})

const toEditComp = (c: ComponentOut): EditComponent => ({
  product_id: c.product_id, composite_id: c.composite_id,
  quantity: c.quantity, unit: c.unit, is_composite: c.is_composite,
})

export default function IntermediateProducts() {
  const [showArchived, setShowArchived] = useState(false)
  const { data, loading, error, reload } = useQuery(
    () => getIntermediateProducts(showArchived), [showArchived],
  )
  const { data: allProducts }  = useQuery(() => getAllProducts(40))
  const { data: allLocations } = useQuery(getStockLocations)

  const [selected,  setSelected]  = useState<RecipeDetail | null>(null)
  const [editing,   setEditing]   = useState<EditState | null>(null)
  const [producing, setProducing] = useState<ProduceState | null>(null)
  const [batches,   setBatches]   = useState<ProductionBatchOut[] | null>(null)

  const [productSearch, setProductSearch] = useState<Record<number, string>>({})
  const [openDropdown,  setOpenDropdown]  = useState<number | null>(null)
  const [qtyDraft,      setQtyDraft]      = useState<Record<number, string>>({})

  const productName = (id: number | null) =>
    allProducts?.find(p => p.id === id)?.name ?? ''

  const closeEditor = () => {
    setEditing(null)
    setProductSearch({})
    setOpenDropdown(null)
    setQtyDraft({})
  }

  const openDetail = useMutation(async (r: { id: number }) => {
    const d = await getIntermediateProduct(r.id)
    setSelected(d)
    const b = await getProductionBatches(r.id)
    setBatches(b)
  })

  const validate = (e: EditState): string | null => {
    if (!e.name.trim()) return 'Name is required.'
    for (const c of e.components) {
      if (c.product_id === null && c.composite_id === null)
        return 'All ingredients must have a product selected.'
      if (c.quantity <= 0)
        return 'All ingredient quantities must be greater than 0.'
    }
    return null
  }

  const saveMutation = useMutation(async () => {
    if (!editing) return
    const err = validate(editing)
    if (err) throw new Error(err)
    const payload = {
      ...editing,
      servings: 1,
      components: editing.components.map(({ is_composite: _, ...c }) => c),
    }
    if (editing.id) await updateIntermediateProduct(editing.id, payload)
    else             await createIntermediateProduct(payload)
    closeEditor()
    setSelected(null)
    await reload()
  })

  const deleteMutation = useMutation(async () => {
    if (!selected) return
    await deleteRecipe(selected.id)
    setSelected(null)
    setBatches(null)
    await reload()
  })

  const duplicateMutation = useMutation(async () => {
    if (!selected) return
    await duplicateRecipe(selected.id)
    setSelected(null)
    setBatches(null)
    await reload()
  })

  const archiveMutation = useMutation(async (flag: boolean) => {
    if (!selected) return
    await archiveRecipe(selected.id, flag)
    setSelected(null)
    setBatches(null)
    await reload()
  })

  const produceMutation = useMutation(async () => {
    if (!selected || !producing) return
    if (!producing.location_id) throw new Error('Please select a location.')
    const payload = {
      location_id: producing.location_id,
      batch_size:  producing.batch_size,
      actual_yield: producing.useActualYield ? producing.actual_yield : null,
      notes: producing.notes,
    }
    await produceIntermediateBatch(selected.id, payload)
    setProducing(null)
    const [updated, newBatches] = await Promise.all([
      getIntermediateProduct(selected.id),
      getProductionBatches(selected.id),
    ])
    setSelected(updated)
    setBatches(newBatches)
    await reload()
  })

  if (loading) return <Spinner />
  if (error)   return <p style={{ color: 'red' }}>{error}</p>
  if (!data)   return null

  const openCreate = () => setEditing(emptyEdit())

  const openEdit = () => {
    if (!selected) return
    setEditing({
      id:                selected.id,
      name:              selected.name,
      category:          selected.category,
      yield_quantity:    selected.yield_quantity,
      yield_unit:        selected.yield_unit,
      prep_time_minutes: selected.prep_time_minutes,
      notes:             selected.notes,
      components:        selected.components.map(toEditComp),
    })
  }

  const openProduce = () => {
    if (!selected) return
    const defaultLocation = allLocations?.[0]?.id ?? ''
    setProducing({
      location_id: defaultLocation,
      batch_size: 1,
      actual_yield: null,
      notes: null,
      useActualYield: false,
    })
    produceMutation.reset?.()
  }

  const addComponent = () =>
    setEditing(e => e ? { ...e, components: [...e.components, emptyComp()] } : e)

  const updateComp = (i: number, patch: Partial<EditComponent>) =>
    setEditing(e => e ? {
      ...e, components: e.components.map((c, idx) => idx === i ? { ...c, ...patch } : c),
    } : e)

  const removeComp = (i: number) =>
    setEditing(e => e ? { ...e, components: e.components.filter((_, idx) => idx !== i) } : e)

  const moveComp = (i: number, dir: -1 | 1) =>
    setEditing(e => {
      if (!e) return e
      const arr = [...e.components]
      const j = i + dir
      if (j < 0 || j >= arr.length) return e
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
      return { ...e, components: arr }
    })

  const intermediateOptions = (data ?? []).filter(r => r.id !== editing?.id)

  const expectedYield = producing && selected
    ? (selected.yield_quantity ?? 1) * producing.batch_size
    : null

  const batchCostPreview = producing && selected
    ? selected.total_food_cost * producing.batch_size
    : null

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ marginTop: 0 }}>Intermediate Products</h1>
        <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.85rem', cursor: 'pointer', color: '#6b7280' }}>
            <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
            Show archived
          </label>
          <button className="btn-primary" onClick={openCreate}>+ New Intermediate Product</button>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Category</th>
            <th>Batch Cost</th>
            <th>Yield / Batch</th>
            <th>In Stock</th>
            <th>Can Make</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {data.length === 0 && (
            <tr><td colSpan={7} style={{ color: '#9ca3af', textAlign: 'center', padding: '2rem' }}>
              No intermediate products yet — click "+ New Intermediate Product" to get started.
            </td></tr>
          )}
          {data.map(r => (
            <tr key={r.id} style={{ opacity: r.is_archived ? 0.5 : 1 }}>
              <td>
                <button
                  style={{ background: 'none', color: '#4f46e5', padding: 0, fontWeight: 500 }}
                  onClick={() => openDetail.mutate(r)}
                >
                  {r.name}
                  {r.is_archived && (
                    <span className="badge" style={{ marginLeft: '.4rem', fontSize: '10px', background: '#f3f4f6', color: '#6b7280' }}>archived</span>
                  )}
                </button>
              </td>
              <td>{r.category ?? '—'}</td>
              <td>€{eur(r.total_food_cost)}</td>
              <td>
                {r.yield_quantity != null
                  ? `${fmt(r.yield_quantity)} ${r.yield_unit ?? ''}`.trim()
                  : '—'}
              </td>
              <td style={{ fontWeight: 600, color: r.current_stock > 0 ? '#065f46' : '#6b7280' }}>
                {fmt(r.current_stock)} {r.yield_unit ?? ''}
              </td>
              <td>{r.max_producible}</td>
              <td><button className="btn-secondary" onClick={() => openDetail.mutate(r)}>View</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ── Detail slide-over ─────────────────────────────────────────────── */}
      {selected && !editing && !producing && (
        <>
          <div onClick={() => { setSelected(null); setBatches(null) }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.3)', zIndex: 40 }} />
          <aside style={{
            position: 'fixed', right: 0, top: 0, bottom: 0, width: 620,
            background: '#fff', zIndex: 50, overflowY: 'auto', padding: '1.5rem',
            boxShadow: '-4px 0 20px rgba(0,0,0,.15)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                  <h2 style={{ margin: 0 }}>{selected.name}</h2>
                  <span className="badge badge-purple" style={{ fontSize: '11px' }}>intermediate</span>
                </div>
                {selected.is_archived && (
                  <span className="badge" style={{ fontSize: '11px', background: '#f3f4f6', color: '#6b7280', marginTop: '.25rem', display: 'inline-block' }}>archived</span>
                )}
              </div>
              <button className="btn-secondary" onClick={() => { setSelected(null); setBatches(null) }}>✕</button>
            </div>

            {/* Stats grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '.75rem', margin: '1rem 0' }}>
              {[
                { l: 'Batch Cost',    v: `€${eur(selected.total_food_cost)}` },
                { l: 'Can Make',      v: selected.max_producible },
                { l: 'In Stock',      v: `${fmt(selected.current_stock)} ${selected.yield_unit ?? ''}`.trim(), hi: selected.current_stock > 0 },
                ...(selected.yield_quantity != null
                  ? [{ l: 'Yield / Batch', v: `${fmt(selected.yield_quantity)} ${selected.yield_unit ?? ''}`.trim() }]
                  : []),
                ...(selected.prep_time_minutes != null
                  ? [{ l: 'Prep time', v: `${selected.prep_time_minutes} min` }]
                  : []),
                ...(selected.bottleneck
                  ? [{ l: 'Bottleneck', v: selected.bottleneck }]
                  : []),
              ].map(s => (
                <div key={s.l} className="card" style={{
                  padding: '.6rem', textAlign: 'center',
                  background: ('hi' in s && s.hi) ? '#f0fdf4' : undefined,
                }}>
                  <div style={{ fontWeight: 700, color: ('hi' in s && s.hi) ? '#065f46' : undefined }}>{s.v}</div>
                  <div style={{ fontSize: '.75rem', color: '#6b7280' }}>{s.l}</div>
                </div>
              ))}
            </div>

            {/* Ingredients */}
            <div style={{ fontWeight: 600, marginBottom: '.4rem', fontSize: '.9rem' }}>Ingredients</div>
            <table>
              <thead><tr><th>Ingredient</th><th>Qty</th><th>Unit Cost</th><th>Total</th><th>Stock</th></tr></thead>
              <tbody>
                {selected.components.map(c => (
                  <tr key={c.id}>
                    <td>
                      {c.is_composite && (
                        <span className="badge badge-purple" style={{ marginRight: '.4rem', fontSize: '10px' }}>recipe</span>
                      )}
                      {c.product_name}
                    </td>
                    <td>{c.quantity} {c.unit}</td>
                    <td>€{eur(c.unit_cost)}</td>
                    <td>€{eur(c.component_cost)}</td>
                    <td style={{ color: c.can_produce === 0 ? '#dc2626' : '#6b7280' }}>{c.can_produce}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Used in recipes */}
            {selected.linked_in_recipes.length > 0 && (
              <div style={{ marginTop: '1.25rem' }}>
                <div style={{ fontWeight: 600, marginBottom: '.4rem', fontSize: '.9rem' }}>Used in Recipes</div>
                <table>
                  <thead><tr><th>Recipe</th><th>Qty Needed</th><th>Selling Price</th></tr></thead>
                  <tbody>
                    {selected.linked_in_recipes.map(r => (
                      <tr key={r.id}>
                        <td>{r.name}</td>
                        <td>{r.quantity} {r.unit ?? ''}</td>
                        <td>{r.selling_price != null ? `€${eur(r.selling_price)}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Batch history */}
            {batches && batches.length > 0 && (
              <div style={{ marginTop: '1.25rem' }}>
                <div style={{ fontWeight: 600, marginBottom: '.4rem', fontSize: '.9rem' }}>Production History</div>
                <table>
                  <thead><tr><th>Date</th><th>Location</th><th>Batch ×</th><th>Total Cost</th></tr></thead>
                  <tbody>
                    {batches.map(b => (
                      <tr key={b.id}>
                        <td>{new Date(b.produced_at).toLocaleDateString('el-GR')}</td>
                        <td>{b.location_name}</td>
                        <td>×{b.batch_size}</td>
                        <td>€{eur(b.total_food_cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {selected.notes && (
              <p style={{ color: '#6b7280', fontSize: '.85rem', marginTop: '1rem', fontStyle: 'italic' }}>{selected.notes}</p>
            )}

            {/* Actions */}
            <div style={{ marginTop: '1rem', display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <button className="btn-primary" onClick={openProduce}>Produce Batch</button>
              <button className="btn-secondary" onClick={openEdit}>Edit</button>
              <button
                className="btn-secondary"
                disabled={duplicateMutation.loading}
                onClick={() => duplicateMutation.mutate(undefined as void)}
              >
                {duplicateMutation.loading ? 'Duplicating…' : 'Duplicate'}
              </button>
              <button
                className="btn-secondary"
                disabled={archiveMutation.loading}
                onClick={() => archiveMutation.mutate(!selected.is_archived)}
              >
                {selected.is_archived ? 'Unarchive' : 'Archive'}
              </button>
              <button
                className="btn-danger"
                disabled={deleteMutation.loading}
                onClick={() => { if (confirm('Delete this intermediate product?')) deleteMutation.mutate(undefined as void) }}
              >
                {deleteMutation.loading ? 'Deleting…' : 'Delete'}
              </button>
              {(deleteMutation.error || duplicateMutation.error || archiveMutation.error) && (
                <span style={{ color: '#b91c1c', fontSize: '.85rem' }}>
                  {deleteMutation.error ?? duplicateMutation.error ?? archiveMutation.error}
                </span>
              )}
            </div>
          </aside>
        </>
      )}

      {/* ── Produce Batch modal ───────────────────────────────────────────── */}
      {producing && selected && (
        <>
          <div onClick={() => setProducing(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 60 }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            background: '#fff', borderRadius: '.75rem', zIndex: 70,
            width: '92%', maxWidth: 460,
            boxShadow: '0 20px 60px rgba(0,0,0,.25)',
          }}>
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e5e7eb', fontWeight: 700, fontSize: '1.05rem' }}>
              Produce Batch — {selected.name}
            </div>

            <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
              {/* Cost + yield preview */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.6rem' }}>
                <div className="card" style={{ padding: '.6rem', textAlign: 'center', background: '#f0fdf4' }}>
                  <div style={{ fontWeight: 700, color: '#065f46' }}>
                    {batchCostPreview != null ? `€${eur(batchCostPreview)}` : '—'}
                  </div>
                  <div style={{ fontSize: '.75rem', color: '#6b7280' }}>Batch Cost</div>
                </div>
                <div className="card" style={{ padding: '.6rem', textAlign: 'center' }}>
                  <div style={{ fontWeight: 700 }}>
                    {expectedYield != null
                      ? `${fmt(expectedYield)} ${selected.yield_unit ?? ''}`.trim()
                      : '—'}
                  </div>
                  <div style={{ fontSize: '.75rem', color: '#6b7280' }}>Expected Yield</div>
                </div>
              </div>

              {/* Location */}
              <label>
                <div className="field-label">Location *</div>
                <select
                  value={producing.location_id}
                  onChange={e => setProducing({ ...producing, location_id: +e.target.value || '' })}
                >
                  <option value="">— select location —</option>
                  {(allLocations ?? []).map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </label>

              {/* Batch size */}
              <label>
                <div className="field-label">Batch Size (multiplier)</div>
                <input
                  type="number" step="0.5" min="0.1"
                  value={producing.batch_size}
                  onChange={e => setProducing({ ...producing, batch_size: Math.max(0.1, +e.target.value || 1) })}
                />
              </label>

              {/* Actual yield override */}
              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.85rem', cursor: 'pointer', marginBottom: '.4rem' }}>
                  <input
                    type="checkbox"
                    checked={producing.useActualYield}
                    onChange={e => setProducing({ ...producing, useActualYield: e.target.checked, actual_yield: null })}
                  />
                  Override actual yield
                </label>
                {producing.useActualYield && (
                  <input
                    type="number" step="0.01" min="0"
                    placeholder={expectedYield != null ? String(fmt(expectedYield)) : ''}
                    value={producing.actual_yield ?? ''}
                    onChange={e => setProducing({ ...producing, actual_yield: e.target.value ? +e.target.value : null })}
                  />
                )}
              </div>

              {/* Notes */}
              <label>
                <div className="field-label">Notes</div>
                <textarea
                  rows={2}
                  value={producing.notes ?? ''}
                  onChange={e => setProducing({ ...producing, notes: e.target.value || null })}
                  style={{ width: '100%', resize: 'vertical' }}
                />
              </label>

              {produceMutation.error && (
                <p style={{ color: '#b91c1c', fontSize: '.85rem', margin: 0 }}>{produceMutation.error}</p>
              )}
            </div>

            <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid #e5e7eb', display: 'flex', gap: '.75rem' }}>
              <button
                className="btn-primary"
                disabled={produceMutation.loading}
                onClick={() => produceMutation.mutate(undefined as void)}
              >
                {produceMutation.loading ? 'Posting…' : 'Post Batch'}
              </button>
              <button className="btn-secondary" onClick={() => setProducing(null)}>Cancel</button>
            </div>
          </div>
        </>
      )}

      {/* ── Edit / Create modal ───────────────────────────────────────────── */}
      {editing && (
        <>
          <div onClick={closeEditor}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 40 }} />
          <div style={{
            position: 'fixed', top: '3%', left: '50%', transform: 'translateX(-50%)',
            background: '#fff', borderRadius: '.75rem', zIndex: 50,
            width: '92%', maxWidth: 820, maxHeight: '90vh',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 20px 60px rgba(0,0,0,.25)',
          }}>
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e5e7eb', fontWeight: 700, fontSize: '1.1rem' }}>
              {editing.id ? 'Edit Intermediate Product' : 'New Intermediate Product'}
            </div>

            <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '.75rem' }}>

              {/* Name */}
              <label>
                <div className="field-label">Name *</div>
                <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} />
              </label>

              {/* Category + Prep time */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
                <label>
                  <div className="field-label">Category</div>
                  <input value={editing.category ?? ''} onChange={e => setEditing({ ...editing, category: e.target.value || null })} />
                </label>
                <label>
                  <div className="field-label">Prep time (min)</div>
                  <input type="number" min="0" placeholder="—"
                    value={editing.prep_time_minutes ?? ''}
                    onChange={e => setEditing({ ...editing, prep_time_minutes: e.target.value ? +e.target.value : null })} />
                </label>
              </div>

              {/* Yield quantity + unit */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
                <label>
                  <div className="field-label">Yield per Batch</div>
                  <input type="number" step="0.01" placeholder="e.g. 2.5"
                    value={editing.yield_quantity ?? ''}
                    onChange={e => setEditing({ ...editing, yield_quantity: e.target.value ? +e.target.value : null })} />
                </label>
                <label>
                  <div className="field-label">Yield Unit</div>
                  <input placeholder="e.g. L, kg, portions"
                    value={editing.yield_unit ?? ''}
                    onChange={e => setEditing({ ...editing, yield_unit: e.target.value || null })} />
                </label>
              </div>

              {/* Notes */}
              <label>
                <div className="field-label">Notes</div>
                <textarea
                  rows={2}
                  value={editing.notes ?? ''}
                  onChange={e => setEditing({ ...editing, notes: e.target.value || null })}
                  style={{ width: '100%', resize: 'vertical' }}
                />
              </label>

              {/* Ingredients BOM */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.5rem' }}>
                  <div className="field-label" style={{ marginBottom: 0 }}>Ingredients (BOM)</div>
                  <button className="btn-secondary" style={{ fontSize: '12px', padding: '4px 10px' }} onClick={addComponent}>
                    + Add Ingredient
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                  {editing.components.map((c, i) => (
                    <div key={i} style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto auto 1fr 80px 64px auto',
                      gap: '.4rem', alignItems: 'center',
                      background: '#f8fafc', borderRadius: '8px', padding: '.5rem .6rem',
                    }}>
                      {/* Up / down */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                        <button className="btn-secondary" style={{ padding: '2px 6px', fontSize: '10px', lineHeight: 1 }}
                          disabled={i === 0} onClick={() => moveComp(i, -1)}>▲</button>
                        <button className="btn-secondary" style={{ padding: '2px 6px', fontSize: '10px', lineHeight: 1 }}
                          disabled={i === editing.components.length - 1} onClick={() => moveComp(i, 1)}>▼</button>
                      </div>

                      {/* Product / Recipe toggle */}
                      <div style={{ display: 'flex', borderRadius: '6px', overflow: 'hidden', border: '1px solid #e5e7eb' }}>
                        <button className={!c.is_composite ? 'btn-primary' : 'btn-secondary'}
                          style={{ padding: '3px 9px', fontSize: '11px', borderRadius: 0, border: 'none' }}
                          onClick={() => updateComp(i, { is_composite: false, composite_id: null })}>Product</button>
                        <button className={c.is_composite ? 'btn-primary' : 'btn-secondary'}
                          style={{ padding: '3px 9px', fontSize: '11px', borderRadius: 0, border: 'none', borderLeft: '1px solid #e5e7eb' }}
                          onClick={() => updateComp(i, { is_composite: true, product_id: null })}>Recipe</button>
                      </div>

                      {/* Selector */}
                      {c.is_composite ? (
                        <select value={c.composite_id ?? ''}
                          onChange={e => updateComp(i, { composite_id: +e.target.value || null })}>
                          <option value="">— select recipe —</option>
                          {intermediateOptions.map(r => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                      ) : (
                        <div style={{ position: 'relative' }}>
                          <input
                            placeholder="Search product…"
                            value={openDropdown === i ? (productSearch[i] ?? '') : productName(c.product_id)}
                            onChange={e => setProductSearch(s => ({ ...s, [i]: e.target.value }))}
                            onFocus={() => { setOpenDropdown(i); setProductSearch(s => ({ ...s, [i]: '' })) }}
                            onBlur={() => setTimeout(() => setOpenDropdown(d => d === i ? null : d), 150)}
                            style={{ width: '100%' }}
                          />
                          {openDropdown === i && (() => {
                            const term = (productSearch[i] ?? '').toLowerCase()
                            const hits = (allProducts ?? [])
                              .filter(p => !term || p.name.toLowerCase().includes(term))
                              .slice(0, 40)
                            return (
                              <div style={{
                                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
                                background: '#fff', border: '1px solid #e5e7eb', borderRadius: '6px',
                                boxShadow: '0 4px 12px rgba(0,0,0,.15)', maxHeight: 220, overflowY: 'auto',
                              }}>
                                {hits.length === 0
                                  ? <div style={{ padding: '6px 10px', color: '#9ca3af', fontSize: '13px' }}>No products found</div>
                                  : hits.map(p => (
                                    <div key={p.id}
                                      onMouseDown={() => { updateComp(i, { product_id: p.id }); setOpenDropdown(null) }}
                                      style={{ padding: '6px 10px', cursor: 'pointer', fontSize: '13px', background: p.id === c.product_id ? '#eff6ff' : undefined }}
                                    >{p.name}</div>
                                  ))
                                }
                              </div>
                            )
                          })()}
                        </div>
                      )}

                      {/* Quantity */}
                      <input
                        type="number" step="0.001" min="0" placeholder="Qty"
                        value={i in qtyDraft ? qtyDraft[i] : (c.quantity || '')}
                        onChange={e => {
                          setQtyDraft(d => ({ ...d, [i]: e.target.value }))
                          const n = e.target.valueAsNumber
                          if (!isNaN(n) && n >= 0) updateComp(i, { quantity: n })
                        }}
                        onFocus={e => {
                          setQtyDraft(d => ({ ...d, [i]: c.quantity ? String(c.quantity) : '' }))
                          e.target.select()
                        }}
                        onBlur={() => {
                          const n = parseFloat(qtyDraft[i] ?? '')
                          if (!isNaN(n) && n >= 0) updateComp(i, { quantity: n })
                          setQtyDraft(d => { const next = { ...d }; delete next[i]; return next })
                        }}
                      />

                      {/* Unit */}
                      <input
                        placeholder={c.is_composite ? 'srv' : 'unit'}
                        value={c.unit ?? ''}
                        onChange={e => updateComp(i, { unit: e.target.value || null })}
                      />

                      {/* Remove */}
                      <button className="btn-danger" style={{ padding: '4px 8px' }}
                        onClick={() => { if (confirm('Remove this ingredient?')) removeComp(i) }}>✕</button>
                    </div>
                  ))}
                  {editing.components.length === 0 && (
                    <div style={{ color: '#9ca3af', fontSize: '13px', padding: '.5rem 0' }}>
                      No ingredients yet — click "+ Add Ingredient" above.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid #e5e7eb', display: 'flex', gap: '.75rem', alignItems: 'center' }}>
              {saveMutation.error && (
                <span style={{ color: '#b91c1c', fontSize: '.85rem', flex: 1 }}>{saveMutation.error}</span>
              )}
              <button
                className="btn-primary"
                disabled={saveMutation.loading}
                onClick={() => saveMutation.mutate(undefined as void)}
              >
                {saveMutation.loading ? 'Saving…' : 'Save'}
              </button>
              <button className="btn-secondary" onClick={closeEditor}>Cancel</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
