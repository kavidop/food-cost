import { useState } from 'react'
import {
  getRecipes, getRecipe, createRecipe, updateRecipe, deleteRecipe,
  getAllProducts, duplicateRecipe, archiveRecipe,
} from '@/api/client'
import { useQuery }    from '@/hooks/useAsync'
import { useMutation } from '@/hooks/useMutation'
import Spinner         from '@/components/Spinner'
import type { RecipeListItem, RecipeDetail, ComponentOut } from '@/types/api'

const eur = (n: number) =>
  n.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type EditComponent = {
  product_id:   number | null
  composite_id: number | null
  quantity: number
  unit: string | null
  is_composite: boolean
}

type EditState = {
  id?:                      number
  name:                     string
  category:                 string | null
  selling_price:            number | null
  selling_price_takeaway:   number | null
  selling_price_delivery:   number | null
  servings:                 number
  yield_quantity:           number | null
  yield_unit:               string | null
  prep_time_minutes:        number | null
  notes:                    string | null
  components:               EditComponent[]
}

const emptyComp = (): EditComponent => ({
  product_id: null, composite_id: null, quantity: 0, unit: null, is_composite: false,
})

const empty = (): EditState => ({
  name: '', category: null,
  selling_price: null, selling_price_takeaway: null, selling_price_delivery: null,
  servings: 1, yield_quantity: null, yield_unit: null, prep_time_minutes: null,
  notes: null, components: [],
})

const toEditComp = (c: ComponentOut): EditComponent => ({
  product_id:   c.product_id,
  composite_id: c.composite_id,
  quantity:     c.quantity,
  unit:         c.unit,
  is_composite: c.is_composite,
})

export default function Recipes() {
  const [showArchived, setShowArchived] = useState(false)
  const { data, loading, error, reload } = useQuery(
    () => getRecipes(showArchived), [showArchived]
  )
  const { data: allProducts } = useQuery(() => getAllProducts(40))
  const [selected, setSelected] = useState<RecipeDetail | null>(null)
  const [editing,  setEditing]  = useState<EditState | null>(null)

  // Per-component search state
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

  const openDetail = useMutation(async (r: RecipeListItem) => {
    const d = await getRecipe(r.id)
    setSelected(d)
  })

  const validate = (e: EditState): string | null => {
    if (!e.name.trim())    return 'Recipe name is required.'
    if (e.servings < 1)    return 'Servings must be at least 1.'
    for (const c of e.components) {
      if (c.product_id === null && c.composite_id === null)
        return 'All ingredients must have a product or recipe selected.'
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
      product_type: 'composite',
      components: editing.components.map(({ is_composite: _, ...c }) => c),
    }
    if (editing.id) await updateRecipe(editing.id, payload)
    else             await createRecipe(payload)
    closeEditor()
    setSelected(null)
    await reload()
  })

  const deleteMutation = useMutation(async () => {
    if (!selected) return
    await deleteRecipe(selected.id)
    setSelected(null)
    await reload()
  })

  const duplicateMutation = useMutation(async () => {
    if (!selected) return
    await duplicateRecipe(selected.id)
    setSelected(null)
    await reload()
  })

  const archiveMutation = useMutation(async (flag: boolean) => {
    if (!selected) return
    await archiveRecipe(selected.id, flag)
    setSelected(null)
    await reload()
  })

  if (loading) return <Spinner />
  if (error)   return <p style={{ color: 'red' }}>{error}</p>
  if (!data)   return null

  const openCreate = () => setEditing(empty())

  const openEdit = () => {
    if (!selected) return
    setEditing({
      id:                     selected.id,
      name:                   selected.name,
      category:               selected.category,
      selling_price:          selected.selling_price,
      selling_price_takeaway: selected.selling_price_takeaway,
      selling_price_delivery: selected.selling_price_delivery,
      servings:               selected.servings,
      yield_quantity:         selected.yield_quantity,
      yield_unit:             selected.yield_unit,
      prep_time_minutes:      selected.prep_time_minutes,
      notes:                  selected.notes,
      components:             selected.components.map(toEditComp),
    })
  }

  const addComponent = () =>
    setEditing(e => e ? { ...e, components: [emptyComp(), ...e.components] } : e)

  const updateComp = (i: number, patch: Partial<EditComponent>) =>
    setEditing(e => e ? {
      ...e,
      components: e.components.map((c, idx) => idx === i ? { ...c, ...patch } : c),
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

  const compositeOptions = (data ?? []).filter(r => r.id !== editing?.id)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ marginTop: 0 }}>Recipes / Composite Products</h1>
        <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.85rem', cursor: 'pointer', color: '#6b7280' }}>
            <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
            Show archived
          </label>
          <button className="btn-primary" onClick={openCreate}>+ New Recipe</button>
        </div>
      </div>

      <table>
        <thead>
          <tr><th>Name</th><th>Category</th><th>Dine-in</th><th>Takeaway</th><th>Delivery</th><th>Food Cost</th><th>Margin</th><th>Can Make</th><th></th></tr>
        </thead>
        <tbody>
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
              <td>{r.selling_price            != null ? `€${eur(r.selling_price)}`            : '—'}</td>
              <td>{r.selling_price_takeaway   != null ? `€${eur(r.selling_price_takeaway)}`   : '—'}</td>
              <td>{r.selling_price_delivery   != null ? `€${eur(r.selling_price_delivery)}`   : '—'}</td>
              <td>€{eur(r.total_food_cost)}</td>
              <td>{r.margin_pct != null ? `${r.margin_pct}%` : '—'}</td>
              <td>{r.max_producible}</td>
              <td><button className="btn-secondary" onClick={() => openDetail.mutate(r)}>View</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ── Detail slide-over ────────────────────────────────────────────── */}
      {selected && !editing && (
        <>
          <div onClick={() => setSelected(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.3)', zIndex: 40 }} />
          <aside style={{
            position: 'fixed', right: 0, top: 0, bottom: 0, width: 580,
            background: '#fff', zIndex: 50, overflowY: 'auto', padding: '1.5rem',
            boxShadow: '-4px 0 20px rgba(0,0,0,.15)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h2 style={{ margin: 0 }}>{selected.name}</h2>
                {selected.is_archived && (
                  <span className="badge" style={{ fontSize: '11px', background: '#f3f4f6', color: '#6b7280', marginTop: '.25rem', display: 'inline-block' }}>archived</span>
                )}
              </div>
              <button className="btn-secondary" onClick={() => setSelected(null)}>✕</button>
            </div>

            {/* Stats grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem', margin: '1rem 0' }}>
              {[
                { l: 'Food Cost',    v: `€${eur(selected.total_food_cost)}` },
                { l: 'Can Make',     v: selected.max_producible },
                { l: 'Bottleneck',   v: selected.bottleneck ?? '—' },
                { l: 'Servings',     v: selected.servings },
                ...(selected.yield_quantity != null
                  ? [{ l: 'Yield', v: `${selected.yield_quantity} ${selected.yield_unit ?? ''}`.trim() }]
                  : []),
                ...(selected.prep_time_minutes != null
                  ? [{ l: 'Prep time', v: `${selected.prep_time_minutes} min` }]
                  : []),
              ].map(s => (
                <div key={s.l} className="card" style={{ padding: '.6rem', textAlign: 'center' }}>
                  <div style={{ fontWeight: 700 }}>{s.v}</div>
                  <div style={{ fontSize: '.75rem', color: '#6b7280' }}>{s.l}</div>
                </div>
              ))}
            </div>

            {/* Selling prices */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '.75rem', marginBottom: '1rem' }}>
              {([
                ['Dine-in',  selected.selling_price],
                ['Takeaway', selected.selling_price_takeaway],
                ['Delivery', selected.selling_price_delivery],
              ] as [string, number | null][]).map(([channel, sp]) => {
                const fc = selected.total_food_cost
                const margin = sp && sp > 0 ? Math.round((sp - fc) / sp * 1000) / 10 : null
                return (
                  <div key={channel} className="card" style={{ padding: '.6rem', textAlign: 'center', background: sp ? '#f0fdf4' : '#f9fafb' }}>
                    <div style={{ fontWeight: 700, fontSize: '1rem' }}>{sp != null ? `€${eur(sp)}` : '—'}</div>
                    <div style={{ fontSize: '.7rem', color: '#6b7280', marginTop: 2 }}>{channel}</div>
                    {margin != null && (
                      <div style={{ fontSize: '.72rem', fontWeight: 600, color: margin >= 0 ? '#065f46' : '#dc2626', marginTop: 2 }}>
                        {margin}% margin
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Ingredients */}
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

            {selected.notes && (
              <p style={{ color: '#6b7280', fontSize: '.85rem', marginTop: '1rem', fontStyle: 'italic' }}>{selected.notes}</p>
            )}

            {/* Actions */}
            <div style={{ marginTop: '1rem', display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <button className="btn-primary" onClick={openEdit}>Edit</button>
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
                onClick={() => { if (confirm('Delete this recipe?')) deleteMutation.mutate(undefined as void) }}
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

      {/* ── Edit / create modal ──────────────────────────────────────────── */}
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
              {editing.id ? 'Edit Recipe' : 'New Recipe'}
            </div>

            <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '.75rem' }}>

              {/* Row 1: Name */}
              <label>
                <div className="field-label">Name *</div>
                <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} />
              </label>

              {/* Row 2: Category + Servings */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
                <label>
                  <div className="field-label">Category</div>
                  <input value={editing.category ?? ''} onChange={e => setEditing({ ...editing, category: e.target.value || null })} />
                </label>
                <label>
                  <div className="field-label">Servings *</div>
                  <input type="number" min="1" value={editing.servings}
                    onChange={e => setEditing({ ...editing, servings: Math.max(1, +e.target.value) })} />
                </label>
              </div>

              {/* Row 3: Yield + Prep time */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '.75rem' }}>
                <label>
                  <div className="field-label">Yield Quantity</div>
                  <input type="number" step="0.01" placeholder="e.g. 2.5"
                    value={editing.yield_quantity ?? ''}
                    onChange={e => setEditing({ ...editing, yield_quantity: e.target.value ? +e.target.value : null })} />
                </label>
                <label>
                  <div className="field-label">Yield Unit</div>
                  <input placeholder="e.g. kg, L, portions"
                    value={editing.yield_unit ?? ''}
                    onChange={e => setEditing({ ...editing, yield_unit: e.target.value || null })} />
                </label>
                <label>
                  <div className="field-label">Prep time (min)</div>
                  <input type="number" min="0" placeholder="—"
                    value={editing.prep_time_minutes ?? ''}
                    onChange={e => setEditing({ ...editing, prep_time_minutes: e.target.value ? +e.target.value : null })} />
                </label>
              </div>

              {/* Row 4: Selling prices */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '.75rem' }}>
                <label>
                  <div className="field-label">Dine-in Price (€)</div>
                  <input type="number" step="0.01" placeholder="—"
                    value={editing.selling_price ?? ''}
                    onChange={e => setEditing({ ...editing, selling_price: e.target.value ? +e.target.value : null })} />
                </label>
                <label>
                  <div className="field-label">Takeaway Price (€)</div>
                  <input type="number" step="0.01" placeholder="—"
                    value={editing.selling_price_takeaway ?? ''}
                    onChange={e => setEditing({ ...editing, selling_price_takeaway: e.target.value ? +e.target.value : null })} />
                </label>
                <label>
                  <div className="field-label">Delivery Price (€)</div>
                  <input type="number" step="0.01" placeholder="—"
                    value={editing.selling_price_delivery ?? ''}
                    onChange={e => setEditing({ ...editing, selling_price_delivery: e.target.value ? +e.target.value : null })} />
                </label>
              </div>

              {/* Row 5: Notes */}
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
                      {/* Up / down reorder */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                        <button
                          className="btn-secondary"
                          style={{ padding: '2px 6px', fontSize: '10px', lineHeight: 1 }}
                          disabled={i === 0}
                          onClick={() => moveComp(i, -1)}
                        >▲</button>
                        <button
                          className="btn-secondary"
                          style={{ padding: '2px 6px', fontSize: '10px', lineHeight: 1 }}
                          disabled={i === editing.components.length - 1}
                          onClick={() => moveComp(i, 1)}
                        >▼</button>
                      </div>

                      {/* Product / Recipe toggle */}
                      <div style={{ display: 'flex', borderRadius: '6px', overflow: 'hidden', border: '1px solid #e5e7eb' }}>
                        <button
                          className={!c.is_composite ? 'btn-primary' : 'btn-secondary'}
                          style={{ padding: '3px 9px', fontSize: '11px', borderRadius: 0, border: 'none' }}
                          onClick={() => updateComp(i, { is_composite: false, composite_id: null })}
                        >Product</button>
                        <button
                          className={c.is_composite ? 'btn-primary' : 'btn-secondary'}
                          style={{ padding: '3px 9px', fontSize: '11px', borderRadius: 0, border: 'none', borderLeft: '1px solid #e5e7eb' }}
                          onClick={() => updateComp(i, { is_composite: true, product_id: null })}
                        >Recipe</button>
                      </div>

                      {/* Item selector */}
                      {c.is_composite ? (
                        <select
                          value={c.composite_id ?? ''}
                          onChange={e => updateComp(i, { composite_id: +e.target.value || null })}
                        >
                          <option value="">— select recipe —</option>
                          {compositeOptions.map(r => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                      ) : (
                        <div style={{ position: 'relative' }}>
                          <input
                            placeholder="Search product…"
                            value={openDropdown === i ? (productSearch[i] ?? '') : productName(c.product_id)}
                            onChange={e => setProductSearch(s => ({ ...s, [i]: e.target.value }))}
                            onFocus={() => {
                              setOpenDropdown(i)
                              setProductSearch(s => ({ ...s, [i]: '' }))
                            }}
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
                                    <div
                                      key={p.id}
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
                      <button
                        className="btn-danger"
                        style={{ padding: '4px 8px' }}
                        onClick={() => { if (confirm('Remove this ingredient from the recipe?')) removeComp(i) }}
                      >✕</button>
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
