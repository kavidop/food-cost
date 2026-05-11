import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  listCountSessions, createCountSession, getStockLocations,
} from '@/api/client'
import { useQuery }    from '@/hooks/useAsync'
import { useMutation } from '@/hooks/useMutation'
import Spinner from '@/components/Spinner'
import type { CountSessionOut } from '@/types/api'

const STATUS_CFG = {
  draft:            { label: 'Draft',            bg: '#fef3c7', color: '#92400e' },
  pending_approval: { label: 'Pending Approval', bg: '#dbeafe', color: '#1e40af' },
  committed:        { label: 'Committed',        bg: '#d1fae5', color: '#065f46' },
} as const

function StatusBadge({ status }: { status: CountSessionOut['status'] }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.draft
  return (
    <span style={{
      display: 'inline-block', padding: '.15rem .55rem', borderRadius: 9999,
      fontSize: '.72rem', fontWeight: 600, letterSpacing: '.02em',
      background: cfg.bg, color: cfg.color,
    }}>
      {cfg.label}
    </span>
  )
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

export default function StockCount() {
  const navigate = useNavigate()
  const [showCreate, setShowCreate] = useState(false)
  const [newLocationId, setNewLocationId] = useState<number | ''>('')
  const [newNotes, setNewNotes]           = useState('')
  const [createError, setCreateError]     = useState<string | null>(null)

  const { data: locations } = useQuery(getStockLocations)
  const { data, loading, error, reload } = useQuery(listCountSessions)

  const doCreate = useMutation(async () => {
    if (!newLocationId) throw new Error('Select a location')
    await createCountSession({ location_id: newLocationId as number, notes: newNotes || null })
    setShowCreate(false)
    setNewLocationId('')
    setNewNotes('')
    reload()
  })

  const handleCreate = async () => {
    setCreateError(null)
    try {
      await doCreate.mutate(undefined)
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create session')
    }
  }

  if (loading && !data) return <Spinner />
  if (error) return <p style={{ color: '#dc2626' }}>{error}</p>

  const sessions  = data?.sessions ?? []
  const draft     = sessions.filter(s => s.status === 'draft').length
  const pending   = sessions.filter(s => s.status === 'pending_approval').length
  const committed = sessions.filter(s => s.status === 'committed').length

  const th: React.CSSProperties = {
    padding: '.5rem .75rem', textAlign: 'left', fontSize: '.72rem',
    fontWeight: 700, color: '#6b7280', textTransform: 'uppercase',
    letterSpacing: '.05em', borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap',
  }
  const td: React.CSSProperties = {
    padding: '.55rem .75rem', fontSize: '.85rem', color: '#374151',
    borderBottom: '1px solid #f3f4f6', verticalAlign: 'middle',
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700, color: '#111827' }}>
            Stock Count
          </h1>
          <p style={{ margin: '.2rem 0 0', color: '#6b7280', fontSize: '.85rem' }}>
            Physical inventory count sessions and reconciliation
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          style={{
            padding: '.5rem 1rem', background: '#111827', color: 'white',
            border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '.85rem', fontWeight: 600,
          }}
        >
          + New Count
        </button>
      </div>

      {/* Summary tiles */}
      <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <Tile label="Total sessions"   value={sessions.length} />
        <Tile label="Draft"            value={draft}    accent={draft   > 0 ? '#92400e' : undefined} />
        <Tile label="Pending approval" value={pending}  accent={pending > 0 ? '#1e40af' : undefined} />
        <Tile label="Committed"        value={committed} />
      </div>

      {/* Table */}
      {sessions.length === 0 ? (
        <p style={{ color: '#6b7280', padding: '2rem 0', textAlign: 'center' }}>
          No count sessions yet. Start a new count to begin.
        </p>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
            <thead style={{ background: '#f9fafb' }}>
              <tr>
                <th style={th}>ID</th>
                <th style={th}>Location</th>
                <th style={th}>Date</th>
                <th style={{ ...th, textAlign: 'right' }}>Lines</th>
                <th style={{ ...th, textAlign: 'right' }}>Counted</th>
                <th style={{ ...th, textAlign: 'right' }}>Variances</th>
                <th style={th}>Status</th>
                <th style={th}>Notes</th>
                <th style={{ ...th, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map(s => (
                <tr
                  key={s.id}
                  style={{ background: 'white' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f0f9ff')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'white')}
                >
                  <td style={{ ...td, color: '#6b7280' }}>#{s.id}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{s.location_name}</td>
                  <td style={td}>{s.count_date ?? s.counted_at.slice(0, 10)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{s.line_count}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {s.counted_lines} / {s.line_count}
                  </td>
                  <td style={{ ...td, textAlign: 'right',
                    fontWeight: s.total_variance_items > 0 ? 600 : undefined,
                    color: s.total_variance_items > 0 ? '#dc2626' : undefined,
                  }}>
                    {s.total_variance_items}
                  </td>
                  <td style={td}><StatusBadge status={s.status} /></td>
                  <td style={{ ...td, color: '#6b7280', maxWidth: 200 }}>
                    {s.notes ?? <span style={{ color: '#9ca3af' }}>—</span>}
                  </td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    <button
                      onClick={() => navigate(`/stock-count/${s.id}`)}
                      style={{
                        padding: '.2rem .5rem', fontSize: '.72rem', cursor: 'pointer',
                        background: 'white', border: '1px solid #d1d5db', borderRadius: 4,
                        color: '#374151', fontWeight: 500,
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'white')}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create session slide-in panel */}
      {showCreate && (
        <>
          <div
            onClick={() => setShowCreate(false)}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,.3)', zIndex: 50,
            }}
          />
          <div style={{
            position: 'fixed', top: 0, right: 0, width: 380, height: '100vh',
            background: 'white', zIndex: 60, boxShadow: '-4px 0 24px rgba(0,0,0,.12)',
            padding: '1.5rem', overflowY: 'auto',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>New Count Session</h2>
              <button
                onClick={() => setShowCreate(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: '#6b7280' }}
              >
                ×
              </button>
            </div>

            <label style={{ display: 'block', fontSize: '.85rem', fontWeight: 600, color: '#374151', marginBottom: '.35rem' }}>
              Location *
            </label>
            <select
              value={newLocationId}
              onChange={e => setNewLocationId(e.target.value === '' ? '' : Number(e.target.value))}
              style={{
                width: '100%', padding: '.45rem .6rem', border: '1px solid #d1d5db',
                borderRadius: 6, fontSize: '.85rem', marginBottom: '1rem',
              }}
            >
              <option value="">Select location…</option>
              {(locations ?? []).map(l => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>

            <label style={{ display: 'block', fontSize: '.85rem', fontWeight: 600, color: '#374151', marginBottom: '.35rem' }}>
              Notes
            </label>
            <textarea
              value={newNotes}
              onChange={e => setNewNotes(e.target.value)}
              rows={3}
              placeholder="Optional notes for this count…"
              style={{
                width: '100%', padding: '.45rem .6rem', border: '1px solid #d1d5db',
                borderRadius: 6, fontSize: '.85rem', resize: 'vertical', boxSizing: 'border-box',
                marginBottom: '1rem',
              }}
            />

            <p style={{ fontSize: '.8rem', color: '#6b7280', marginBottom: '1.25rem' }}>
              Creating a session will snapshot current stock quantities for all products at the selected location.
            </p>

            {createError && (
              <p style={{ color: '#dc2626', fontSize: '.82rem', marginBottom: '.75rem' }}>{createError}</p>
            )}

            <button
              onClick={handleCreate}
              disabled={doCreate.loading || !newLocationId}
              style={{
                width: '100%', padding: '.6rem', background: '#111827', color: 'white',
                border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '.9rem', fontWeight: 600,
              }}
            >
              {doCreate.loading ? 'Creating…' : 'Start Count'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
