import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import {
  getCountSession, updateCountLines, updateCountNotes, getProductReferenceData,
} from '@/api/client'
import { useQuery } from '@/hooks/useAsync'
import Spinner from '@/components/Spinner'
import type { CountLineOut, CountCategoryNodeOut, CategoryOut } from '@/types/api'

const fmtQty = (n: number) => (n % 1 === 0 ? String(n) : n.toFixed(3).replace(/\.?0+$/, ''))

function buildParentMap(cats: CategoryOut[]) {
  return new Map<number, number | null>(cats.map(c => [c.id, c.parent_id ?? null]))
}

function findGroup(
  catId: number | null,
  selectedIds: Set<number>,
  parentMap: Map<number, number | null>,
): number | null {
  let cur = catId
  while (cur != null) {
    if (selectedIds.has(cur)) return cur
    cur = parentMap.get(cur) ?? null
  }
  return null
}

// ── Auto-growing textarea (no scrollbar) ─────────────────────────────────────

function AutoTextarea({
  value, onChange, placeholder, disabled, style,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
  style?: React.CSSProperties
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  const resize = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])

  useEffect(() => { resize() }, [value, resize])

  return (
    <textarea
      ref={ref}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      rows={1}
      onChange={e => { onChange(e.target.value); resize() }}
      style={{ overflow: 'hidden', resize: 'none', ...style }}
    />
  )
}

// ── Mobile quantity input ─────────────────────────────────────────────────────

function MobileInput({
  initialValue, disabled, onCommit,
}: {
  initialValue: number | null
  disabled: boolean
  onCommit: (v: number | null) => void
}) {
  const [local, setLocal] = useState(initialValue != null ? String(initialValue) : '')
  const prev = useRef(initialValue)

  useEffect(() => {
    if (initialValue !== prev.current) {
      setLocal(initialValue != null ? String(initialValue) : '')
      prev.current = initialValue
    }
  }, [initialValue])

  const hasCounted = local.trim() !== ''

  return (
    <input
      type="number"
      inputMode="decimal"
      min={0}
      step="any"
      disabled={disabled}
      value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => {
        const n = parseFloat(local.trim())
        onCommit(local.trim() === '' ? null : Number.isNaN(n) ? null : n)
      }}
      style={{
        width: 88, height: 52, fontSize: '1.25rem', fontWeight: 700, textAlign: 'center',
        border: `2px solid ${hasCounted ? '#059669' : '#d1d5db'}`,
        borderRadius: 10,
        background: disabled ? '#f3f4f6' : hasCounted ? '#f0fdf4' : 'white',
        color: disabled ? '#9ca3af' : '#111827',
        outline: 'none', touchAction: 'manipulation', flexShrink: 0,
      }}
    />
  )
}

// ── Single line row ───────────────────────────────────────────────────────────

function LineRow({
  line, disabled, count, onCommit,
}: {
  line: CountLineOut
  disabled: boolean
  count: number | null
  onCommit: (v: number | null) => void
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '.75rem',
      padding: '.85rem 1rem', borderBottom: '1px solid #f3f4f6',
      background: count != null ? '#f9fffe' : 'white',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '.95rem', color: '#111827', lineHeight: 1.3 }}>
          {line.product_name}
        </div>
        <div style={{ fontSize: '.78rem', color: '#9ca3af', marginTop: 2 }}>
          System: {line.system_qty != null ? fmtQty(line.system_qty) : '—'} {line.unit ?? ''}
        </div>
      </div>
      <MobileInput initialValue={count} disabled={disabled} onCommit={onCommit} />
      <span style={{ width: 28, fontSize: '.78rem', color: '#9ca3af', flexShrink: 0 }}>
        {line.unit ?? ''}
      </span>
    </div>
  )
}

// ── Category section ──────────────────────────────────────────────────────────

function CategorySection({
  label, lines, counts, disabled, onCommit, defaultOpen, notes, onNotesChange,
}: {
  label: string
  lines: CountLineOut[]
  counts: Record<number, number | null>
  disabled: boolean
  onCommit: (productId: number, v: number | null) => void
  defaultOpen: boolean
  notes: string
  onNotesChange: (v: string) => void
}) {
  const [open, setOpen] = useState(defaultOpen)
  const countedN = lines.filter(l => counts[l.product_id] != null).length
  const done = countedN === lines.length && lines.length > 0

  return (
    <div style={{ borderBottom: '2px solid #e5e7eb' }}>
      {/* Section header */}
      <div
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '.8rem 1rem', background: done ? '#f0fdf4' : '#f9fafb',
          cursor: 'pointer', userSelect: 'none',
        }}
      >
        <span style={{ fontWeight: 700, fontSize: '.95rem', color: done ? '#059669' : '#1e40af' }}>
          {label}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
          {notes.trim() && (
            <span style={{
              fontSize: '.68rem', fontWeight: 600, color: '#7c3aed',
              background: '#f3e8ff', padding: '.1rem .4rem', borderRadius: 9999,
            }}>
              note
            </span>
          )}
          <span style={{ fontSize: '.82rem', fontWeight: 600, color: done ? '#059669' : '#6b7280' }}>
            {countedN}/{lines.length}
          </span>
          <span style={{ color: '#9ca3af', fontSize: '.8rem' }}>{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {open && (
        <>
          {lines.map(l => (
            <LineRow
              key={l.product_id}
              line={l}
              disabled={disabled}
              count={counts[l.product_id] ?? null}
              onCommit={v => onCommit(l.product_id, v)}
            />
          ))}
          {/* Section notes */}
          <div style={{ padding: '.75rem 1rem', background: '#fafafa', borderTop: '1px solid #f3f4f6' }}>
            <AutoTextarea
              placeholder={`Notes for ${label}…`}
              value={notes}
              disabled={disabled}
              onChange={onNotesChange}
              style={{
                width: '100%', boxSizing: 'border-box',
                border: `1px solid ${notes.trim() ? '#c4b5fd' : '#e5e7eb'}`,
                borderRadius: 8, padding: '.5rem .75rem',
                fontSize: '.85rem', color: '#374151',
                background: notes.trim() ? '#faf5ff' : 'white',
                outline: 'none', fontFamily: 'inherit', display: 'block',
              }}
            />
          </div>
        </>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MobileCount() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const id = Number(sessionId)

  const { data: session, loading, error } = useQuery(() => getCountSession(id), [id])
  const { data: refData } = useQuery(getProductReferenceData)

  // Count values — initialized from session once, then managed locally
  const [counts, setCounts] = useState<Record<number, number | null>>({})

  // Per-section notes (keyed by category ID string or 'flat' for no-category mode)
  const [sectionNotes, setSectionNotes] = useState<Record<string, string>>({})

  // Additional / free-form session notes (initialized from session.notes)
  const [additionalNotes, setAdditionalNotes]   = useState('')
  const notesInitialized = useRef(false)

  // Save status for counts
  const [saving,    setSaving]    = useState(false)
  const [savedAt,   setSavedAt]   = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Save status for notes
  const [notesSaving,  setNotesSaving]  = useState(false)
  const [notesSavedAt, setNotesSavedAt] = useState<string | null>(null)
  const [notesError,   setNotesError]   = useState<string | null>(null)

  // Notes panel visibility
  const [showNotes, setShowNotes] = useState(false)

  useEffect(() => {
    if (!session) return
    // Initialize counts from server
    const init: Record<number, number | null> = {}
    session.lines.forEach((l: CountLineOut) => {
      if (l.counted_qty != null) init[l.product_id] = l.counted_qty
    })
    setCounts(init)
    // Initialize additional notes once
    if (!notesInitialized.current) {
      setAdditionalNotes(session.notes ?? '')
      notesInitialized.current = true
    }
  }, [session?.id])

  if (loading && !session) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#f9fafb' }}>
      <Spinner />
    </div>
  )
  if (error || !session) return (
    <div style={{ padding: '2rem', textAlign: 'center', color: '#dc2626' }}>
      {error ?? 'Session not found.'}
    </div>
  )

  const isReadOnly = session.status !== 'draft'
  const lines: CountLineOut[]               = session.lines ?? []
  const sessionCats: CountCategoryNodeOut[] = session.categories ?? []
  const allCats: CategoryOut[]              = refData?.categories ?? []
  const parentMap   = buildParentMap(allCats)
  const selectedIds = new Set(sessionCats.map(c => c.category_id))
  const catNameById = new Map(sessionCats.map(c => [c.category_id, c.category_name]))

  const totalCounted = lines.filter(l => counts[l.product_id] != null).length
  const total = lines.length
  const pct   = total > 0 ? Math.round((totalCounted / total) * 100) : 0

  // ── Count field save (per-field, on blur) ──
  const saveField = async (productId: number, value: number | null) => {
    setCounts(prev => {
      const next = { ...prev }
      if (value == null) delete next[productId]
      else next[productId] = value
      return next
    })
    setSaving(true)
    setSaveError(null)
    try {
      await updateCountLines(id, [{ product_id: productId, counted_qty: value }])
      setSavedAt(new Date().toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' }))
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ── Notes save ──
  const buildCombinedNotes = (): string => {
    const parts: string[] = []
    if (useGroups) {
      ;[...catGroups.entries()].forEach(([catId]) => {
        const key   = String(catId ?? 'other')
        const label = catId !== null ? (catNameById.get(catId) ?? `Category #${catId}`) : 'Other'
        const note  = sectionNotes[key]?.trim()
        if (note) parts.push(`[${label}]\n${note}`)
      })
    }
    const addl = additionalNotes.trim()
    if (addl) parts.push(addl)
    return parts.join('\n\n')
  }

  const saveNotes = async () => {
    setNotesSaving(true)
    setNotesError(null)
    try {
      await updateCountNotes(id, buildCombinedNotes() || null)
      setNotesSavedAt(new Date().toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' }))
    } catch (e) {
      setNotesError(e instanceof Error ? e.message : 'Failed to save notes')
    } finally {
      setNotesSaving(false)
    }
  }

  // ── Build category groups ──
  const useGroups = selectedIds.size > 0
  const catGroups = new Map<number | null, CountLineOut[]>()
  if (useGroups) {
    sessionCats.forEach(c => catGroups.set(c.category_id, []))
    catGroups.set(null, [])
    lines.forEach(l => {
      const gid = findGroup(l.category_id ?? null, selectedIds, parentMap)
      if (gid !== null && catGroups.has(gid)) catGroups.get(gid)!.push(l)
      else catGroups.get(null)!.push(l)
    })
    if ((catGroups.get(null)?.length ?? 0) === 0) catGroups.delete(null)
  }

  // Notes preview (section notes only, for the combined view)
  const sectionNotesPreview = useGroups
    ? [...catGroups.entries()]
        .map(([catId]) => {
          const key   = String(catId ?? 'other')
          const label = catId !== null ? (catNameById.get(catId) ?? `Category #${catId}`) : 'Other'
          const note  = sectionNotes[key]?.trim()
          return note ? `[${label}]\n${note}` : ''
        })
        .filter(Boolean)
        .join('\n\n')
    : ''

  const STATUS_BANNER: Record<string, string> = {
    pending_approval: 'This session is pending approval — read only',
    committed:        'This session is committed — read only',
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb', display: 'flex', flexDirection: 'column', maxWidth: 680, margin: '0 auto' }}>

      {/* ── Sticky header ── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: '#0f0e1a', color: 'white', padding: '1rem 1.1rem .8rem',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '.6rem' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.75rem' }}>
            <img
              src="/logo.jpg"
              alt="Zúbro"
              style={{ width: 56, height: 56, objectFit: 'contain', filter: 'invert(1)', mixBlendMode: 'screen', flexShrink: 0, marginTop: 2 }}
            />
            <div>
              <div style={{ fontSize: '.65rem', color: '#818cf8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 3 }}>
                Stock Count
              </div>
              <div style={{ fontWeight: 700, fontSize: '1.05rem', lineHeight: 1.2 }}>
                {session.location_name}
              </div>
              <div style={{ fontSize: '.78rem', color: '#a5b4fc', marginTop: 3 }}>
                Session #{session.id}
                {(session.count_date ?? session.counted_at?.slice(0, 10)) && (
                  <> &middot; {session.count_date ?? session.counted_at?.slice(0, 10)}</>
                )}
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color: pct === 100 ? '#34d399' : '#f9fafb', lineHeight: 1 }}>
              {pct}%
            </div>
            <div style={{ fontSize: '.72rem', color: '#a5b4fc', marginTop: 2 }}>
              {totalCounted} / {total}
            </div>
          </div>
        </div>
        {/* Progress bar */}
        <div style={{ height: 5, background: '#1e1b4b', borderRadius: 99 }}>
          <div style={{
            height: '100%', borderRadius: 99, transition: 'width .25s ease',
            background: pct === 100 ? '#34d399' : '#6366f1',
            width: `${pct}%`,
          }} />
        </div>
      </div>

      {/* ── Read-only banner ── */}
      {isReadOnly && (
        <div style={{
          background: '#fef3c7', borderBottom: '1px solid #fde68a',
          padding: '.6rem 1rem', fontSize: '.85rem', color: '#92400e',
          fontWeight: 600, textAlign: 'center',
        }}>
          {STATUS_BANNER[session.status] ?? 'Read only'}
        </div>
      )}

      {/* ── Count lines ── */}
      <div style={{ flex: 1, background: 'white' }}>
        {lines.length === 0 ? (
          <p style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>
            No products in this session yet.
          </p>
        ) : useGroups ? (
          [...catGroups.entries()].map(([catId, groupLines], i) => {
            const key   = String(catId ?? 'other')
            const label = catId !== null ? (catNameById.get(catId) ?? `Category #${catId}`) : 'Other'
            return (
              <CategorySection
                key={key}
                label={label}
                lines={groupLines}
                counts={counts}
                disabled={isReadOnly}
                onCommit={saveField}
                defaultOpen={i === 0}
                notes={sectionNotes[key] ?? ''}
                onNotesChange={v => setSectionNotes(prev => ({ ...prev, [key]: v }))}
              />
            )
          })
        ) : (
          lines.map(l => (
            <LineRow
              key={l.product_id}
              line={l}
              disabled={isReadOnly}
              count={counts[l.product_id] ?? null}
              onCommit={v => saveField(l.product_id, v)}
            />
          ))
        )}
      </div>

      {/* ── Session Notes panel ── */}
      <div style={{ background: 'white', borderTop: '2px solid #e5e7eb' }}>

        {/* Toggle header — always visible */}
        <div
          onClick={() => setShowNotes(v => !v)}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '.85rem 1rem', cursor: 'pointer', userSelect: 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
            <span style={{ fontWeight: 700, fontSize: '1rem', color: '#111827' }}>
              Session Notes
            </span>
            {(sectionNotesPreview || additionalNotes.trim()) && (
              <span style={{
                fontSize: '.68rem', fontWeight: 700, background: '#6366f1',
                color: 'white', padding: '.1rem .45rem', borderRadius: 9999,
              }}>
                saved
              </span>
            )}
          </div>
          <span style={{ fontSize: '1.1rem', color: '#9ca3af', lineHeight: 1 }}>
            {showNotes ? '▲' : '▼'}
          </span>
        </div>

        {/* Expanded content */}
        {showNotes && (
          <div style={{ padding: '0 1rem 1rem' }}>

            {/* Section notes preview */}
            {sectionNotesPreview && (
              <div style={{
                background: '#faf5ff', border: '1px solid #c4b5fd', borderRadius: 8,
                padding: '.65rem .85rem', marginBottom: '.75rem',
                fontSize: '.82rem', color: '#374151', whiteSpace: 'pre-wrap',
                fontFamily: 'inherit', lineHeight: 1.5,
              }}>
                {sectionNotesPreview}
              </div>
            )}

            {/* Additional / free-form notes */}
            <AutoTextarea
              placeholder="Additional session notes…"
              value={additionalNotes}
              disabled={isReadOnly}
              onChange={setAdditionalNotes}
              style={{
                width: '100%', boxSizing: 'border-box',
                border: '1px solid #e5e7eb', borderRadius: 8,
                padding: '.65rem .85rem', fontSize: '.9rem',
                color: '#374151',
                background: isReadOnly ? '#f9fafb' : 'white',
                outline: 'none', fontFamily: 'inherit', lineHeight: 1.5,
                display: 'block', marginBottom: '.85rem',
              }}
            />

            {/* Footer row: status + Save + Close */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', justifyContent: 'space-between' }}>
              <div style={{
                fontSize: '.8rem', fontWeight: 500, flex: 1,
                color: notesError ? '#dc2626' : notesSaving ? '#6366f1' : notesSavedAt ? '#059669' : '#9ca3af',
              }}>
                {notesError   ? notesError
                 : notesSaving  ? 'Saving…'
                 : notesSavedAt ? `Saved ${notesSavedAt}`
                 : ''}
              </div>
              {!isReadOnly && (
                <button
                  onClick={saveNotes}
                  disabled={notesSaving}
                  style={{
                    padding: '.5rem 1.1rem', background: '#6366f1', color: 'white',
                    border: 'none', borderRadius: 8, fontSize: '.88rem', fontWeight: 700,
                    cursor: notesSaving ? 'not-allowed' : 'pointer', opacity: notesSaving ? .6 : 1,
                    flexShrink: 0,
                  }}
                >
                  {notesSaving ? 'Saving…' : 'Save Notes'}
                </button>
              )}
              <button
                onClick={() => setShowNotes(false)}
                style={{
                  padding: '.5rem .9rem', background: 'white', color: '#374151',
                  border: '1px solid #d1d5db', borderRadius: 8,
                  fontSize: '.88rem', fontWeight: 600, cursor: 'pointer', flexShrink: 0,
                }}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Sticky count-save footer ── */}
      <div style={{
        position: 'sticky', bottom: 0, zIndex: 10,
        background: 'white', borderTop: '1px solid #e5e7eb',
        padding: '.65rem 1rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.75rem',
      }}>
        <div style={{
          fontSize: '.8rem', fontWeight: 500,
          color: saveError ? '#dc2626' : saving ? '#6366f1' : savedAt ? '#059669' : '#9ca3af',
        }}>
          {saving    ? 'Saving…'
           : saveError ? saveError
           : savedAt   ? `Count saved ${savedAt}`
           : 'Tap a quantity field to start counting'}
        </div>
        <div style={{ fontSize: '.75rem', color: '#d1d5db', flexShrink: 0 }}>
          {totalCounted}/{total}
        </div>
      </div>
    </div>
  )
}
