import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  getCountSession, updateCountLines, updateCountDate,
  submitCountSession, approveCountSession, exportCountSession, refreshCountSession,
  removeCountLine, setCountCategories, getProductReferenceData,
} from '@/api/client'
import { useQuery }    from '@/hooks/useAsync'
import { useMutation } from '@/hooks/useMutation'
import Spinner from '@/components/Spinner'
import type { CountLineOut, CountCategoryNodeOut, CategoryOut } from '@/types/api'

const STATUS_LABEL: Record<string, string> = {
  draft:            'Draft',
  pending_approval: 'Pending Approval',
  committed:        'Committed',
}

const STATUS_COLOR: Record<string, string> = {
  draft:            '#92400e',
  pending_approval: '#1e40af',
  committed:        '#065f46',
}

const STATUS_BG: Record<string, string> = {
  draft:            '#fef3c7',
  pending_approval: '#dbeafe',
  committed:        '#d1fae5',
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

function QtyInput({
  value, onChange, disabled,
}: { value: number | null; onChange: (v: number | null) => void; disabled: boolean }) {
  const [local, setLocal] = useState(value != null ? String(value) : '')
  const prevValue = useRef(value)

  useEffect(() => {
    if (value !== prevValue.current) {
      setLocal(value != null ? String(value) : '')
      prevValue.current = value
    }
  }, [value])

  return (
    <input
      type="number"
      min={0}
      step="any"
      disabled={disabled}
      value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => {
        const parsed = local.trim() === '' ? null : parseFloat(local)
        onChange(Number.isNaN(parsed as number) ? null : parsed)
      }}
      style={{
        width: 90, padding: '.3rem .45rem', border: '1px solid #d1d5db',
        borderRadius: 4, fontSize: '.85rem', textAlign: 'right',
        background: disabled ? '#f9fafb' : 'white',
      }}
    />
  )
}

// ── Category manager ─────────────────────────────────────────────────────────

function buildSortedCategories(all: CategoryOut[]): Array<CategoryOut & { depth: number }> {
  const childMap = new Map<number | null, CategoryOut[]>()
  all.forEach(c => {
    const key = c.parent_id ?? null
    if (!childMap.has(key)) childMap.set(key, [])
    childMap.get(key)!.push(c)
  })
  const result: Array<CategoryOut & { depth: number }> = []
  function walk(parentId: number | null, depth: number) {
    const children = childMap.get(parentId) ?? []
    children.sort((a, b) => a.name.localeCompare(b.name))
    children.forEach(c => {
      result.push({ ...c, depth })
      walk(c.id, depth + 1)
    })
  }
  walk(null, 0)
  return result
}

function CategoryManager({
  sessionId,
  currentCategories,
  allCategories,
  editable,
  onSaved,
}: {
  sessionId: number
  currentCategories: CountCategoryNodeOut[]
  allCategories: CategoryOut[]
  editable: boolean
  onSaved: () => void
}) {
  const [draftIds, setDraftIds] = useState<number[]>(() => currentCategories.map(c => c.category_id))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Sync draft when parent categories change (after reload)
  const prevLen = useRef(currentCategories.length)
  useEffect(() => {
    if (currentCategories.length !== prevLen.current) {
      setDraftIds(currentCategories.map(c => c.category_id))
      prevLen.current = currentCategories.length
    }
  }, [currentCategories])

  const sorted = buildSortedCategories(allCategories)
  const draftSet = new Set(draftIds)
  const available = sorted.filter(c => !draftSet.has(c.id))

  const addCategory = (id: number) => {
    setDraftIds(prev => [...prev, id])
  }

  const removeCategory = (id: number) => {
    setDraftIds(prev => prev.filter(x => x !== id))
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await setCountCategories(sessionId, draftIds)
      onSaved()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const isDirty = JSON.stringify(draftIds) !== JSON.stringify(currentCategories.map(c => c.category_id))

  // Build name lookup
  const nameById = new Map(allCategories.map(c => [c.id, c.name]))

  return (
    <div style={{
      border: '1px solid #e5e7eb', borderRadius: 8,
      background: '#f9fafb', padding: '1rem', marginBottom: '1rem',
    }}>
      <div style={{ fontWeight: 600, fontSize: '.88rem', color: '#374151', marginBottom: '.75rem' }}>
        Category Groups
        <span style={{ fontWeight: 400, fontSize: '.8rem', color: '#9ca3af', marginLeft: '.5rem' }}>
          Products will be grouped by these categories during the count
        </span>
      </div>

      {/* Selected categories */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem', marginBottom: '.75rem' }}>
        {draftIds.length === 0 && (
          <span style={{ fontSize: '.82rem', color: '#9ca3af', fontStyle: 'italic' }}>
            No categories selected — products shown in a flat list
          </span>
        )}
        {draftIds.map(id => (
          <span key={id} style={{
            display: 'inline-flex', alignItems: 'center', gap: '.3rem',
            padding: '.25rem .6rem', background: '#dbeafe', color: '#1e40af',
            border: '1px solid #93c5fd', borderRadius: 9999, fontSize: '.8rem', fontWeight: 500,
          }}>
            {nameById.get(id) ?? `Cat #${id}`}
            {editable && (
              <button
                onClick={() => removeCategory(id)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: '#3b82f6', fontSize: '.9rem', lineHeight: 1, padding: 0,
                }}
                title="Remove"
              >×</button>
            )}
          </span>
        ))}
      </div>

      {editable && (
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value=""
            onChange={e => { if (e.target.value) addCategory(Number(e.target.value)) }}
            style={{
              padding: '.35rem .6rem', border: '1px solid #d1d5db', borderRadius: 6,
              fontSize: '.82rem', background: 'white', color: '#374151', cursor: 'pointer',
              minWidth: 200,
            }}
          >
            <option value="">+ Add category…</option>
            {available.map(c => (
              <option key={c.id} value={c.id}>
                {'  '.repeat(c.depth)}{c.depth > 0 ? '↳ ' : ''}{c.name}
              </option>
            ))}
          </select>

          {isDirty && (
            <>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  padding: '.35rem .8rem', background: '#059669', color: 'white',
                  border: 'none', borderRadius: 6, fontSize: '.82rem', fontWeight: 600,
                  cursor: saving ? 'not-allowed' : 'pointer',
                }}
              >
                {saving ? 'Saving…' : 'Save Groups'}
              </button>
              <button
                onClick={() => setDraftIds(currentCategories.map(c => c.category_id))}
                disabled={saving}
                style={{
                  padding: '.35rem .8rem', background: 'white', color: '#374151',
                  border: '1px solid #d1d5db', borderRadius: 6, fontSize: '.82rem', cursor: 'pointer',
                }}
              >
                Reset
              </button>
            </>
          )}
          {error && <span style={{ color: '#dc2626', fontSize: '.8rem' }}>{error}</span>}
        </div>
      )}
    </div>
  )
}

// ── Count line row ────────────────────────────────────────────────────────────

function CountRow({
  line, isEditable, edits, sessionStatus,
  onEdit, onRemove,
}: {
  line: CountLineOut
  isEditable: boolean
  edits: Record<number, number | null>
  sessionStatus: string
  onEdit: (productId: number, v: number | null) => void
  onRemove: (productId: number) => void
}) {
  const localQty = line.product_id in edits ? edits[line.product_id] : line.counted_qty
  const variance = localQty != null && line.system_qty != null
    ? round4(localQty - line.system_qty)
    : line.variance
  const hasVariance = variance != null && Math.abs(variance) > 0.0001

  const td: React.CSSProperties = {
    padding: '.45rem .75rem', fontSize: '.85rem', color: '#374151',
    borderBottom: '1px solid #f3f4f6', verticalAlign: 'middle',
  }

  return (
    <tr
      style={{ background: hasVariance ? '#fff7ed' : 'white' }}
      onMouseEnter={e => (e.currentTarget.style.background = hasVariance ? '#ffedd5' : '#f0f9ff')}
      onMouseLeave={e => (e.currentTarget.style.background = hasVariance ? '#fff7ed' : 'white')}
    >
      <td style={td}>{line.product_name}</td>
      <td style={{ ...td, textAlign: 'right', color: '#6b7280' }}>{line.unit ?? '—'}</td>
      <td style={{ ...td, textAlign: 'right' }}>
        {line.system_qty != null ? fmtQty(line.system_qty) : <span style={{ color: '#9ca3af' }}>—</span>}
      </td>
      <td style={{ ...td, textAlign: 'right' }}>
        <QtyInput
          value={localQty ?? null}
          disabled={!isEditable}
          onChange={v => onEdit(line.product_id, v)}
        />
      </td>
      <td style={{
        ...td, textAlign: 'right', fontWeight: hasVariance ? 700 : undefined,
        color: variance == null ? '#9ca3af'
             : variance > 0 ? '#059669'
             : variance < 0 ? '#dc2626'
             : '#374151',
      }}>
        {variance == null ? '—'
          : variance > 0 ? `+${fmtQty(variance)}`
          : fmtQty(variance)}
      </td>
      {sessionStatus === 'draft' && (
        <td style={{ ...td, textAlign: 'center', width: 40 }}>
          {(line.system_qty == null || line.system_qty === 0) && (
            <button
              onClick={() => onRemove(line.product_id)}
              title="Remove from count"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: '#9ca3af', fontSize: '1rem', lineHeight: 1, padding: '2px 4px',
                borderRadius: 4,
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#dc2626'; e.currentTarget.style.background = '#fee2e2' }}
              onMouseLeave={e => { e.currentTarget.style.color = '#9ca3af'; e.currentTarget.style.background = 'none' }}
            >×</button>
          )}
        </td>
      )}
    </tr>
  )
}

// ── Collapsible category section ──────────────────────────────────────────────

function CategorySection({
  label, accent, lines, isEditable, edits, sessionStatus,
  onEdit, onRemove, defaultExpanded,
}: {
  label: string
  accent?: string
  lines: CountLineOut[]
  isEditable: boolean
  edits: Record<number, number | null>
  sessionStatus: string
  onEdit: (productId: number, v: number | null) => void
  onRemove: (productId: number) => void
  defaultExpanded: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  const counted  = lines.filter(l => (l.product_id in edits ? edits[l.product_id] : l.counted_qty) != null).length
  const variances = lines.filter(l => {
    const qty = l.product_id in edits ? edits[l.product_id] : l.counted_qty
    const v = qty != null && l.system_qty != null ? round4(qty - l.system_qty) : l.variance
    return v != null && Math.abs(v) > 0.0001
  }).length

  const th: React.CSSProperties = {
    padding: '.5rem .75rem', textAlign: 'left', fontSize: '.72rem',
    fontWeight: 700, color: '#6b7280', textTransform: 'uppercase',
    letterSpacing: '.05em', borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap',
  }

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: '.75rem', overflow: 'hidden' }}>
      <div
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: '.75rem',
          padding: '.6rem 1rem', background: '#f9fafb',
          cursor: 'pointer', userSelect: 'none',
          borderBottom: expanded ? '1px solid #e5e7eb' : 'none',
        }}
      >
        <span style={{ fontSize: '.65rem', color: '#9ca3af' }}>{expanded ? '▼' : '▶'}</span>
        <span style={{
          fontWeight: 700, fontSize: '.88rem',
          color: accent ?? '#374151',
        }}>{label}</span>
        <span style={{
          fontSize: '.75rem', color: '#6b7280', marginLeft: 'auto', display: 'flex', gap: '.5rem',
        }}>
          <span>{counted}/{lines.length} counted</span>
          {variances > 0 && (
            <span style={{ color: '#dc2626', fontWeight: 600 }}>· {variances} variance{variances > 1 ? 's' : ''}</span>
          )}
        </span>
      </div>

      {expanded && (
        lines.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: '.82rem', padding: '.75rem 1rem', margin: 0 }}>
            No products in this group.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
              <thead style={{ background: '#f9fafb' }}>
                <tr>
                  <th style={th}>Product</th>
                  <th style={{ ...th, textAlign: 'right' }}>Unit</th>
                  <th style={{ ...th, textAlign: 'right' }}>System Qty</th>
                  <th style={{ ...th, textAlign: 'right' }}>Counted Qty</th>
                  <th style={{ ...th, textAlign: 'right' }}>Variance</th>
                  {sessionStatus === 'draft' && <th style={th} />}
                </tr>
              </thead>
              <tbody>
                {lines.map(line => (
                  <CountRow
                    key={line.product_id}
                    line={line}
                    isEditable={isEditable}
                    edits={edits}
                    sessionStatus={sessionStatus}
                    onEdit={onEdit}
                    onRemove={onRemove}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function StockCountDetail() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate      = useNavigate()
  const id            = Number(sessionId)

  const { data: session, loading, error, reload } = useQuery(
    () => getCountSession(id), [id],
  )
  const { data: refData } = useQuery(() => getProductReferenceData(), [])
  const allCategories: CategoryOut[] = refData?.categories ?? []

  const [edits, setEdits]               = useState<Record<number, number | null>>({})
  const [dirty, setDirty]               = useState(false)
  const [saveError, setSaveError]       = useState<string | null>(null)
  const [actionError, setActionError]   = useState<string | null>(null)
  const [filter, setFilter]             = useState<'all' | 'uncounted' | 'variance'>('all')
  const [search, setSearch]             = useState('')
  const [countDate, setCountDate]       = useState<string>('')
  const [copied, setCopied]             = useState(false)
  const [showCategoryMgr, setShowCategoryMgr] = useState(false)

  useEffect(() => {
    setEdits({})
    setDirty(false)
  }, [session?.id, session?.status])

  useEffect(() => {
    if (session) setCountDate(session.count_date ?? session.counted_at.slice(0, 10))
  }, [session?.id, session?.count_date, session?.counted_at])

  const doSave = useMutation(async () => {
    const lines = Object.entries(edits).map(([pid, qty]) => ({
      product_id: Number(pid),
      counted_qty: qty,
    }))
    await updateCountLines(id, lines)
    setEdits({})
    setDirty(false)
    reload()
  })

  const doSubmit   = useMutation(async () => { await submitCountSession(id);  reload() })
  const doApprove  = useMutation(async () => { await approveCountSession(id); reload() })
  const doExport   = useMutation(async () => { await exportCountSession(id, `stock_count_${id}.csv`) })
  const doRefresh  = useMutation(async () => { await refreshCountSession(id); reload() })
  const doRemoveLine = useMutation(async (productId: number) => { await removeCountLine(id, productId); reload() })
  const doUpdateDate = useMutation(async (newDate: string) => { await updateCountDate(id, newDate); reload() })

  const handleSave = async () => {
    setSaveError(null)
    try { await doSave.mutate(undefined) }
    catch (e: unknown) { setSaveError(e instanceof Error ? e.message : 'Save failed') }
  }

  const handleSubmit = async () => {
    setActionError(null)
    try { await doSubmit.mutate(undefined) }
    catch (e: unknown) { setActionError(e instanceof Error ? e.message : 'Submit failed') }
  }

  const handleApprove = async () => {
    setActionError(null)
    try { await doApprove.mutate(undefined) }
    catch (e: unknown) { setActionError(e instanceof Error ? e.message : 'Approve failed') }
  }

  if (loading && !session) return <Spinner />
  if (error) return <p style={{ color: '#dc2626' }}>{error}</p>
  if (!session) return <p style={{ color: '#6b7280' }}>Session not found.</p>

  const isEditable = session.status !== 'committed'

  const resolvedLine = (line: CountLineOut) => {
    const cq = line.product_id in edits ? edits[line.product_id] : line.counted_qty
    return { ...line, counted_qty: cq ?? line.counted_qty }
  }

  const lines = (session.lines ?? []).map(resolvedLine)

  // ── Category grouping ────────────────────────────────────────────────────
  const sessionCategories = session.categories ?? []
  const parentMap = new Map<number, number | null>(allCategories.map(c => [c.id, c.parent_id ?? null]))
  const selectedCatIds = new Set(sessionCategories.map(c => c.category_id))

  function findGroup(categoryId: number | null): number | null {
    let cur = categoryId
    while (cur != null) {
      if (selectedCatIds.has(cur)) return cur
      cur = parentMap.get(cur) ?? null
    }
    return null
  }

  // ── Filtering ────────────────────────────────────────────────────────────
  const filtered = lines.filter(l => {
    if (search && !l.product_name.toLowerCase().includes(search.toLowerCase())) return false
    if (filter === 'uncounted') return l.counted_qty == null
    if (filter === 'variance')  return l.variance != null && Math.abs(l.variance) > 0.0001
    return true
  })

  const uncounted = lines.filter(l => l.counted_qty == null).length
  const variances = lines.filter(l => l.variance != null && Math.abs(l.variance) > 0.0001).length

  // ── Group filtered lines ─────────────────────────────────────────────────
  const useGrouped = sessionCategories.length > 0
  const grouped = new Map<number | null, CountLineOut[]>()
  if (useGrouped) {
    filtered.forEach(line => {
      const gid = findGroup(line.category_id ?? null)
      if (!grouped.has(gid)) grouped.set(gid, [])
      grouped.get(gid)!.push(line)
    })
  }

  const onEdit = (productId: number, v: number | null) => {
    setEdits(prev => ({ ...prev, [productId]: v }))
    setDirty(true)
  }

  const onRemove = (productId: number) => doRemoveLine.mutate(productId)

  const th: React.CSSProperties = {
    padding: '.5rem .75rem', textAlign: 'left', fontSize: '.72rem',
    fontWeight: 700, color: '#6b7280', textTransform: 'uppercase',
    letterSpacing: '.05em', borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap',
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.25rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '.25rem' }}>
            <button
              onClick={() => navigate('/stock-count')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: '.85rem', padding: 0 }}
            >
              ← Stock Count
            </button>
          </div>
          <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700, color: '#111827' }}>
            Count Session #{session.id}
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginTop: '.3rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '.85rem', color: '#6b7280' }}>{session.location_name}</span>
            <span style={{ color: '#d1d5db' }}>·</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: '.35rem' }}>
              <span style={{ fontSize: '.75rem', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                Count Date
              </span>
              <input
                type="date"
                value={countDate}
                disabled={!isEditable}
                onChange={e => setCountDate(e.target.value)}
                onBlur={() => {
                  const prev = session.count_date ?? session.counted_at.slice(0, 10)
                  if (countDate && countDate !== prev) doUpdateDate.mutate(countDate)
                }}
                style={{
                  border: 'none',
                  borderBottom: isEditable ? '1px dashed #d1d5db' : 'none',
                  background: 'transparent', fontSize: '.85rem', color: '#374151',
                  padding: '0 2px', outline: 'none',
                  cursor: isEditable ? 'text' : 'default',
                }}
              />
            </label>
            <span style={{
              display: 'inline-block', padding: '.15rem .55rem', borderRadius: 9999,
              fontSize: '.72rem', fontWeight: 600,
              background: STATUS_BG[session.status], color: STATUS_COLOR[session.status],
            }}>
              {STATUS_LABEL[session.status]}
            </span>
          </div>
          {session.notes && (
            <p style={{ margin: '.4rem 0 0', fontSize: '.82rem', color: '#6b7280' }}>{session.notes}</p>
          )}
        </div>

        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={() => {
              const url = `${window.location.origin}/count/${session.id}`
              navigator.clipboard.writeText(url).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              })
            }}
            style={{
              padding: '.4rem .85rem',
              background: copied ? '#059669' : 'white',
              color: copied ? 'white' : '#374151',
              border: `1px solid ${copied ? '#059669' : '#d1d5db'}`,
              borderRadius: 6, cursor: 'pointer', fontSize: '.82rem', fontWeight: 500,
              transition: 'all .15s',
            }}
          >
            {copied ? 'Link copied!' : 'Mobile link'}
          </button>
          <button
            onClick={() => doExport.mutate(undefined)}
            disabled={doExport.loading}
            style={{
              padding: '.4rem .85rem', background: 'white', color: '#374151',
              border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: '.82rem', fontWeight: 500,
            }}
          >
            {doExport.loading ? 'Exporting…' : 'Export CSV'}
          </button>

          {dirty && isEditable && (
            <button
              onClick={handleSave}
              disabled={doSave.loading}
              style={{
                padding: '.4rem .85rem', background: '#059669', color: 'white',
                border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '.82rem', fontWeight: 600,
              }}
            >
              {doSave.loading ? 'Saving…' : 'Save Draft'}
            </button>
          )}

          {session.status === 'draft' && (
            <button
              onClick={() => doRefresh.mutate(undefined)}
              disabled={doRefresh.loading}
              style={{
                padding: '.4rem .85rem', background: '#fef3c7', color: '#92400e',
                border: '1px solid #fbbf24', borderRadius: 6, cursor: 'pointer', fontSize: '.82rem', fontWeight: 600,
              }}
            >
              {doRefresh.loading ? 'Refreshing…' : 'Refresh from Inventory'}
            </button>
          )}

          {session.status === 'draft' && (
            <button
              onClick={handleSubmit}
              disabled={doSubmit.loading}
              style={{
                padding: '.4rem .85rem', background: '#2563eb', color: 'white',
                border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '.82rem', fontWeight: 600,
              }}
            >
              {doSubmit.loading ? 'Submitting…' : 'Submit for Approval'}
            </button>
          )}

          {session.status === 'pending_approval' && (
            <button
              onClick={handleApprove}
              disabled={doApprove.loading}
              style={{
                padding: '.4rem .85rem', background: '#111827', color: 'white',
                border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '.82rem', fontWeight: 600,
              }}
            >
              {doApprove.loading ? 'Posting…' : 'Approve & Post Variances'}
            </button>
          )}
        </div>
      </div>

      {actionError && <p style={{ color: '#dc2626', fontSize: '.82rem', marginBottom: '.75rem' }}>{actionError}</p>}
      {saveError   && <p style={{ color: '#dc2626', fontSize: '.82rem', marginBottom: '.75rem' }}>{saveError}</p>}

      {/* Tiles */}
      <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <Tile label="Total products"  value={session.line_count} />
        <Tile label="Counted"         value={session.counted_lines} />
        <Tile label="Uncounted"       value={uncounted} accent={uncounted > 0 ? '#d97706' : undefined} />
        <Tile label="Variances"       value={variances}  accent={variances  > 0 ? '#dc2626' : undefined} />
      </div>

      {/* Category groups toggle */}
      <div style={{ marginBottom: '.75rem' }}>
        <button
          onClick={() => setShowCategoryMgr(v => !v)}
          style={{
            padding: '.35rem .75rem', background: showCategoryMgr ? '#eff6ff' : 'white',
            border: `1px solid ${showCategoryMgr ? '#93c5fd' : '#d1d5db'}`,
            borderRadius: 6, cursor: 'pointer', fontSize: '.82rem',
            color: showCategoryMgr ? '#1d4ed8' : '#374151', fontWeight: 500,
            display: 'flex', alignItems: 'center', gap: '.4rem',
          }}
        >
          <span>Category Groups</span>
          {sessionCategories.length > 0 && (
            <span style={{
              background: '#dbeafe', color: '#1e40af', padding: '.1rem .45rem',
              borderRadius: 9999, fontSize: '.72rem', fontWeight: 600,
            }}>{sessionCategories.length}</span>
          )}
          <span style={{ fontSize: '.75rem', color: '#9ca3af' }}>{showCategoryMgr ? '▲' : '▼'}</span>
        </button>

        {showCategoryMgr && (
          <div style={{ marginTop: '.5rem' }}>
            <CategoryManager
              key={sessionCategories.map(c => c.category_id).join(',')}
              sessionId={id}
              currentCategories={sessionCategories}
              allCategories={allCategories}
              editable={isEditable}
              onSaved={() => { reload(); }}
            />
          </div>
        )}
      </div>

      {/* Filters */}
      <div style={{
        display: 'flex', gap: '.75rem', alignItems: 'center', flexWrap: 'wrap',
        padding: '.6rem .85rem', background: '#f9fafb', border: '1px solid #e5e7eb',
        borderRadius: 8, marginBottom: '1rem',
      }}>
        <input
          type="text"
          placeholder="Search products…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            padding: '.35rem .6rem', border: '1px solid #d1d5db', borderRadius: 6,
            fontSize: '.85rem', width: 200,
          }}
        />
        {(['all', 'uncounted', 'variance'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '.3rem .7rem', border: '1px solid',
              borderColor: filter === f ? '#111827' : '#d1d5db',
              borderRadius: 6, fontSize: '.8rem', cursor: 'pointer',
              background: filter === f ? '#111827' : 'white',
              color:      filter === f ? 'white'    : '#374151',
              fontWeight: filter === f ? 600 : 400,
            }}
          >
            {f === 'all' ? 'All' : f === 'uncounted' ? 'Uncounted' : 'Has Variance'}
          </button>
        ))}
        <span style={{ fontSize: '.8rem', color: '#9ca3af', marginLeft: 'auto' }}>
          {filtered.length} of {lines.length}
        </span>
      </div>

      {/* Count sheet */}
      {filtered.length === 0 ? (
        <p style={{ color: '#6b7280', textAlign: 'center', padding: '2rem 0' }}>
          No lines match the current filter.
        </p>
      ) : useGrouped ? (
        /* ── Grouped view ── */
        <div>
          {sessionCategories.map(cat => {
            const groupLines = grouped.get(cat.category_id) ?? []
            return (
              <CategorySection
                key={cat.category_id}
                label={cat.category_name}
                lines={groupLines}
                isEditable={isEditable}
                edits={edits}
                sessionStatus={session.status}
                onEdit={onEdit}
                onRemove={onRemove}
                defaultExpanded={true}
              />
            )
          })}
          {/* Uncategorized */}
          {(grouped.get(null) ?? []).length > 0 && (
            <CategorySection
              label="Uncategorized"
              accent="#9ca3af"
              lines={grouped.get(null) ?? []}
              isEditable={isEditable}
              edits={edits}
              sessionStatus={session.status}
              onEdit={onEdit}
              onRemove={onRemove}
              defaultExpanded={true}
            />
          )}
        </div>
      ) : (
        /* ── Flat view ── */
        <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
            <thead style={{ background: '#f9fafb' }}>
              <tr>
                <th style={th}>Product</th>
                <th style={{ ...th, textAlign: 'right' }}>Unit</th>
                <th style={{ ...th, textAlign: 'right' }}>System Qty</th>
                <th style={{ ...th, textAlign: 'right' }}>Counted Qty</th>
                <th style={{ ...th, textAlign: 'right' }}>Variance</th>
                {session.status === 'draft' && <th style={th} />}
              </tr>
            </thead>
            <tbody>
              {filtered.map(line => (
                <CountRow
                  key={line.product_id}
                  line={line}
                  isEditable={isEditable}
                  edits={edits}
                  sessionStatus={session.status}
                  onEdit={onEdit}
                  onRemove={onRemove}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Sticky save bar */}
      {dirty && isEditable && (
        <div style={{
          position: 'sticky', bottom: 16, display: 'flex', justifyContent: 'flex-end',
          marginTop: '1rem',
        }}>
          <div style={{
            background: 'white', border: '1px solid #d1d5db', borderRadius: 8,
            padding: '.5rem .85rem', boxShadow: '0 4px 12px rgba(0,0,0,.1)',
            display: 'flex', alignItems: 'center', gap: '.75rem',
          }}>
            <span style={{ fontSize: '.82rem', color: '#6b7280' }}>Unsaved changes</span>
            <button
              onClick={() => { setEdits({}); setDirty(false) }}
              style={{
                padding: '.35rem .7rem', background: 'white', border: '1px solid #d1d5db',
                borderRadius: 5, cursor: 'pointer', fontSize: '.82rem', color: '#374151',
              }}
            >
              Discard
            </button>
            <button
              onClick={handleSave}
              disabled={doSave.loading}
              style={{
                padding: '.35rem .7rem', background: '#059669', color: 'white',
                border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: '.82rem', fontWeight: 600,
              }}
            >
              {doSave.loading ? 'Saving…' : 'Save Draft'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function fmtQty(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(4).replace(/\.?0+$/, '')
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}
