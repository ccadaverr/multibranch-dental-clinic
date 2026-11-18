import React, { useEffect, useState } from 'react'
import { Button, Notice } from '../components.jsx'
import { AuthShell } from './AuthShell.jsx'
import { describeResponseLink, performResponseLink } from '../api-client.js'

const TITLES = { attend: 'Confirm your visit', cant_make_it: 'Can’t make it?', on_my_way: 'On your way?', move_up: 'Take the earlier time?' }

/** Reads the one-time token from `#respond/<token>` (the fragment is never sent to a server). */
export function parseRespondHash(hash) {
  const m = /^#respond\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(hash || '')
  return m ? m[1] : null
}

/**
 * F1–F3 one-time email links, without signing in: "I'll be there" and "On my way" are answered as soon as the page opens;
 * "I can't make it" and "Take the earlier time" ask for a confirmation first. The server decides everything (link valid, used,
 * expired, out of date, or the time already taken) and shows only the visit's date, time and branch.
 */
export function RespondLink({ hash }) {
  const [token] = useState(() => parseRespondHash(hash))
  const [state, setState] = useState({ phase: token ? 'loading' : 'invalid', data: null, message: '' })
  useEffect(() => { if (token && typeof window !== 'undefined') window.history.replaceState(null, '', '#respond') }, [token])

  const perform = async confirm => {
    setState(s => ({ ...s, phase: 'working' }))
    const r = await performResponseLink(token, confirm)
    if (r.ok) return setState({ phase: 'done', data: r.data, message: r.data?.message })
    if (confirm && r.kind === 'network') {
      return setState(s => ({ ...s, phase: 'retry', message: 'The clinic response was not received. Check the same appointment again.' }))
    }
    setState(s => ({ phase: 'final', data: s.data, message: r.message || 'That did not work. Please contact the clinic.' }))
  }
  useEffect(() => {
    if (!token) return
    describeResponseLink(token).then(r => {
      if (!r.ok) return setState({ phase: 'invalid', data: null, message: '' })
      const d = r.data
      if (d.state === 'done') return setState({ phase: 'done', data: d, message: d.message })
      if (d.state !== 'ready') return setState({ phase: 'final', data: d, message: d.message })
      if (d.purpose === 'attend' || d.purpose === 'on_my_way') { setState({ phase: 'working', data: d, message: '' }); return perform(false) }
      setState({ phase: 'confirm', data: d, message: '' })
    })
  }, [token])

  const d = state.data, a = d?.appointment
  return <AuthShell><div className="auth-form" aria-labelledby="respond-title" aria-live="polite">
    <div className="login-copy-wrap"><div className="eyebrow">Your appointment</div><h1 id="respond-title">{d ? TITLES[d.purpose] : 'Appointment link'}</h1></div>
    {state.phase === 'invalid' && <Notice tone="warning" title="Link not recognised">Open the link exactly as it appears in the email, or sign in to see your visits.</Notice>}
    {(state.phase === 'loading' || state.phase === 'working') && <p className="login-copy" role="status">One moment…</p>}
    {a && <dl className="respond-facts">
      {d.purpose === 'move_up' && <div><dt>Earlier time</dt><dd>{d.new_time}</dd></div>}
      <div><dt>{d.purpose === 'move_up' ? 'Your current time' : 'Visit'}</dt><dd>{a.when}</dd></div>
      <div><dt>Branch</dt><dd>{a.branch}{a.address ? <small>{a.address}</small> : null}</dd></div>
      <div><dt>Reference</dt><dd>{a.code}</dd></div>
    </dl>}
    {state.phase === 'confirm' && d.purpose === 'cant_make_it' && <>
      <p className="login-copy">This cancels your appointment so another patient can use the time. You can book a new time anytime.</p>
      <Button variant="danger" width="full" onClick={() => perform(true)}>Yes, cancel my appointment</Button>
      <a className="link-button respond-alt" href="#sign-in">Reschedule instead (sign in)</a>
    </>}
    {state.phase === 'confirm' && d.purpose === 'move_up' && <>
      <p className="login-copy">The first patient to accept gets this time. If you take it, your current time is released for someone else.</p>
      <Button width="full" onClick={() => perform(true)}>Yes, move me to the earlier time</Button>
      <a className="link-button respond-alt" href="#home">No thanks, keep my time</a>
    </>}
    {state.phase === 'done' && <Notice tone="success" title="Done">{state.message}</Notice>}
    {state.phase === 'retry' && <Notice tone="warning">{state.message} <Button variant="soft" onClick={() => perform(true)}>Retry original response</Button></Notice>}
    {state.phase === 'done' && d?.cancellation_refund && <Notice tone={d.cancellation_refund.status === 'refunded' ? 'success' : 'warning'}>{d.cancellation_refund.message}</Notice>}
    {state.phase === 'final' && <Notice tone="warning" title="This link can’t be used">{state.message}</Notice>}
    {(state.phase === 'done' || state.phase === 'final') && <p className="login-copy"><a href="#sign-in">Sign in to see your visits</a>{a?.phone ? <> · or call the branch: <a href={`tel:${a.phone.replace(/[^0-9+]/g, '')}`}>{a.phone}</a></> : null}</p>}
  </div></AuthShell>
}
