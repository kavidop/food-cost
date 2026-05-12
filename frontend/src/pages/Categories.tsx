import { useState } from 'react'
import { getCategories, createCategory, updateCategory, deleteCategory } from '@/api/client'
import { useQuery }    from '@/hooks/useAsync'
import { useMutation } from '@/hooks/useMutation'
import Spinner         from '@/components/Spinner'
import type { CategoryOut } from '@/types/api'

export default function Categories() {
  const { data, loading, error, reload } = useQuery(getCategories)
  const [editing,    setEditing]    = useState<CategoryOut | null>(null)
  const [newName,    setNewName]    = useState('')
  const [newParent,  setNewParent]  = useState('')
  const [newService, setNewService] = useState(false)

  const createMutation = useMutation(async () => {
    if (!newName.trim()) return
    await createCategory({
      name: newName.trim(),
      parent_id: newParent ? Number(newParent) : null,
      is_service: newService,
    })
    setNewName('')
    setNewParent('')
    setNewService(false)
    await reload()
  })

  const saveMutation = useMutation(async () => {
    if (!editing) return
    await updateCategory(editing.id, {
      name: editing.name,
      parent_id: editing.parent_id,
      is_service: editing.is_service,
    })
    setEditing(null)
    await reload()
  })

  const deleteMutation = useMutation(async (id: number) => {
    await deleteCategory(id)
    await reload()
  })

  if (loading) return <Spinner />
  if (error)   return <p style={{ color: 'red' }}>{error}</p>
  if (!data)   return null

  const parentName = (id: number | null) =>
    id ? (data.find(c => c.id === id)?.name ?? '—') : '—'

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Categories</h1>

      <div className="card" style={{ marginBottom: '1.5rem', maxWidth: 560 }}>
        <h3 style={{ marginTop: 0 }}>Add Category</h3>
        <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap', marginBottom: '.5rem' }}>
          <input
            placeholder="Category name"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            style={{ flex: 1, minWidth: 140 }}
          />
          <select
            value={newParent}
            onChange={e => setNewParent(e.target.value)}
            style={{ flex: 1, minWidth: 120 }}
          >
            <option value="">No parent</option>
            {data.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button
            className="btn-primary"
            disabled={createMutation.loading}
            onClick={() => createMutation.mutate(undefined as void)}
          >
            {createMutation.loading ? 'Adding…' : 'Add'}
          </button>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.85rem', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={newService}
            onChange={e => setNewService(e.target.checked)}
          />
          <span>Service category</span>
          <span style={{ color: '#9ca3af', fontSize: '.78rem' }}>
            — items in this category won't affect inventory
          </span>
        </label>
        {createMutation.error && (
          <p style={{ color: '#b91c1c', fontSize: '.85rem', marginTop: '.5rem', marginBottom: 0 }}>
            {createMutation.error}
          </p>
        )}
      </div>

      {deleteMutation.error && (
        <div style={{
          background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '.4rem',
          padding: '.6rem .9rem', marginBottom: '1rem', color: '#b91c1c', fontSize: '.85rem',
        }}>
          {deleteMutation.error}
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Parent</th>
            <th>Type</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {data.map(c => (
            <tr key={c.id}>
              <td>
                {editing?.id === c.id ? (
                  <input
                    value={editing.name}
                    onChange={e => setEditing({ ...editing, name: e.target.value })}
                    style={{ maxWidth: 220 }}
                  />
                ) : c.name}
              </td>
              <td>
                {editing?.id === c.id ? (
                  <select
                    value={editing.parent_id ?? ''}
                    onChange={e => setEditing({ ...editing, parent_id: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">No parent</option>
                    {data.filter(o => o.id !== c.id).map(o => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                ) : parentName(c.parent_id)}
              </td>
              <td>
                {editing?.id === c.id ? (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '.35rem', fontSize: '.85rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={editing.is_service}
                      onChange={e => setEditing({ ...editing, is_service: e.target.checked })}
                    />
                    Service
                  </label>
                ) : c.is_service ? (
                  <span style={{
                    padding: '.15rem .5rem', background: '#f3e8ff', color: '#6b21a8',
                    borderRadius: 9999, fontSize: '.72rem', fontWeight: 600,
                  }}>
                    Service
                  </span>
                ) : (
                  <span style={{ color: '#9ca3af', fontSize: '.8rem' }}>Product</span>
                )}
              </td>
              <td style={{ display: 'flex', gap: '.5rem', flexDirection: 'column' }}>
                <div style={{ display: 'flex', gap: '.5rem' }}>
                  {editing?.id === c.id ? (
                    <>
                      <button
                        className="btn-primary"
                        disabled={saveMutation.loading}
                        onClick={() => saveMutation.mutate(undefined as void)}
                      >
                        {saveMutation.loading ? 'Saving…' : 'Save'}
                      </button>
                      <button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button className="btn-secondary" onClick={() => setEditing(c)}>Edit</button>
                      <button
                        className="btn-danger"
                        disabled={deleteMutation.loading}
                        onClick={() => {
                          if (confirm('Delete this category?')) deleteMutation.mutate(c.id)
                        }}
                      >Delete</button>
                    </>
                  )}
                </div>
                {editing?.id === c.id && saveMutation.error && (
                  <p style={{ color: '#b91c1c', fontSize: '.8rem', margin: 0 }}>
                    {saveMutation.error}
                  </p>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
