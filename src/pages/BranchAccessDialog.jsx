import React, { useEffect, useState } from 'react'
import { Button, Modal, Notice } from '../components.jsx'
import { getBranchScopes, setBranchScopes } from '../api-client.js'

// M1: the Owner grants or removes a Staff account's AUTHORIZATION branch scopes (which branches' records the server lets
// them read and act on). This is separate from where they work (their profile branch) — one never implies the other
// (CONTRACTS §1). The server is the authority; this dialog shows only what it returned.
export function BranchAccessDialog({ user, branches, onClose, onSaved }) {
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [selected, setSelected] = useState([])
  const [saved, setSaved] = useState([])
  const load = async () => {
    setStatus('loading'); setError('')
    const result = await getBranchScopes(user.id)
    if (!result.ok) { setError(result.message || 'Could not load branch access.'); setStatus('error'); return }
    const ids = (result.data?.branch_scopes || []).map(b => b.id)
    setSelected(ids); setSaved(ids); setStatus('ready')
  }
  useEffect(() => { load() }, [user.id])
  const toggle = id => setSelected(list => list.includes(id) ? list.filter(x => x !== id) : [...list, id])
  const save = async () => {
    setStatus('saving'); setError('')
    const result = await setBranchScopes(user.id, selected)
    if (!result.ok) { setError(result.message || 'Could not save branch access.'); setStatus('ready'); return }
    const ids = (result.data?.branch_scopes || []).map(b => b.id)
    setSelected(ids); setSaved(ids); setStatus('ready'); onSaved?.(ids)
  }
  const changed = selected.length !== saved.length || selected.some(id => !saved.includes(id))
  return <Modal open title={`Branch access for ${user.name}`} subtitle="Which branches’ records this Staff member can see and act on. Where they work is set on their profile." onClose={onClose}>
    {status === 'loading' && <p className="muted-copy" role="status">Loading branch access…</p>}
    {status === 'error' && <Notice tone="warning" title="Couldn’t load branch access">{error} <Button size="sm" variant="ghost" onClick={load}>Try again</Button></Notice>}
    {(status === 'ready' || status === 'saving') && <>
      <fieldset className="scope-list" disabled={status === 'saving'}>
        <legend className="field-label">Branches</legend>
        {branches.map(b => <label key={b.id} className="scope-option"><input type="checkbox" checked={selected.includes(b.id)} disabled={b.archived && !selected.includes(b.id)} onChange={() => toggle(b.id)}/> <span>{b.name}{b.archived ? ' (archived — historical access only)' : ''}</span></label>)}
      </fieldset>
      {selected.length === 0 && <Notice tone="warning" title="No branch access">With no branch, this Staff member sees no clinic records.</Notice>}
      {error && <Notice tone="warning" title="Not saved">{error}</Notice>}
      <div className="row-actions top-gap">
        <Button onClick={save} disabled={!changed || status === 'saving'}>{status === 'saving' ? 'Saving…' : 'Save branch access'}</Button>
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </div>
      {!changed && status === 'ready' && <p className="muted-copy" role="status">Saved access: {saved.length ? branches.filter(b => saved.includes(b.id)).map(b => b.name).join(', ') : 'none'}.</p>}
    </>}
  </Modal>
}
