import React, { useEffect, useState } from 'react'
import { Button, Card, Notice, PageHeader } from '../components.jsx'
import { dentistApproveMessageTemplate, listMessageTemplates } from '../api-client.js'
import { TemplateEditor } from './Automations.jsx'
import '../dentist-wording.css'

/**
 * Dentist: approve the wording of health-related automated emails (recall, R2-11) and, for recall, the intervals shown with it.
 * The Owner writes the wording; a Dentist only reviews and approves it. Nothing is sent until both approved.
 */
export function WordingApprovalsPage({ store }) {
  const toast = store?.toast || (() => {})
  const [rows, setRows] = useState(null), [rules, setRules] = useState([]), [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    setRows(null); setError('')
    listMessageTemplates().then(r => {
      if (!active) return
      if (r.ok) { setRows(r.data || []); setRules(r.meta?.recall_rules || []) }
      else setError(r.message || 'Could not load the wording.')
    }).catch(() => { if (active) setError('Could not load the wording.') })
    return () => { active = false }
  }, [retry])
  return <div className="cd-page dentist-wording">
    <PageHeader kicker="Dentist" title="Wording to approve" text="Automated emails that touch health need a Dentist’s approval before the clinic can send them."/>
    {error && <Notice tone="warning" title="Wording unavailable">{error} <Button variant="soft" onClick={() => setRetry(n => n + 1)}>Retry wording</Button></Notice>}
    {!rows && !error && <p role="status">Loading wording for review…</p>}
    {(rows || []).map(t => <Card key={t.key} title={t.name} className="wording-review">
      <p className="clinic-inline-help">Revision {t.revision}</p>
      {t.key === 'recall_due' && <p className="au-desc">Recall intervals you approve with this wording: {rules.length ? rules.map(r => `${r.category} every ${r.months} months`).join('; ') : 'none set'}.</p>}
      <TemplateEditor key={`${t.key}:${t.revision}:${!!t.dentist_approval}`} template={t}
        toast={(message, tone) => toast(tone === 'success' ? 'Dentist review approved. Both Owner and Dentist approvals are required before this wording can be used.' : message, tone)}
        canEdit={false} showTest={false} approveAction={dentistApproveMessageTemplate} onChanged={n => setRows(list => list.map(x => (x.key === n.key ? n : x)))}/>
    </Card>)}
    {rows && !rows.length && <p className="au-muted">Nothing needs your approval.</p>}
  </div>
}
