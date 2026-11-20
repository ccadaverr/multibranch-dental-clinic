import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Icon, RefreshButton } from '../components.jsx'

const INITIAL_LOAD = { status: 'loading', loading: true, data: null, error: '' }

/** Reads are bounded and only the newest request for the current page can update it. */
export function useLoad(load, deps = []) {
  const [state, setState] = useState(INITIAL_LOAD)
  const current = useRef(null)
  const run = useCallback(async () => {
    current.current?.abort()
    const controller = new AbortController()
    current.current = controller
    const { signal } = controller
    const stopped = new Promise(resolve => signal.addEventListener('abort', () => resolve({
      ok: false, message: 'This request took too long. Try again.',
    }), { once: true }))
    const timeout = setTimeout(() => controller.abort(), 30000)
    setState(previous => previous.owner === run && previous.data != null
      ? { ...previous, loading: true, status: 'ready', error: '' }
      : { ...INITIAL_LOAD, owner: run })
    let result
    try {
      result = await Promise.race([Promise.resolve().then(() => load(signal)), stopped])
    } catch {
      result = { ok: false, message: 'This could not be loaded. Try again.' }
    } finally {
      clearTimeout(timeout)
      if (current.current === controller) {
        current.current = null
        const retain = !['unauthenticated', 'forbidden', 'stale_context'].includes(result?.kind)
        setState(previous => result?.ok
          ? { owner: run, status: 'ready', loading: false, data: result.data, error: '', meta: result.meta }
          : { owner: run, status: 'error', loading: false, data: retain && previous.owner === run ? previous.data : null, error: result?.message || 'This could not be loaded.' })
      }
    }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    run()
    return () => {
      const active = current.current
      current.current = null
      active?.abort()
    }
  }, [run])
  return { ...(state.owner === run ? state : INITIAL_LOAD), reload: run }
}

export function LoadingState({ label, compact = false }) {
  return <p className={`patient-loading${compact ? ' is-compact' : ''}`} role="status">{label}</p>
}

export function Skeleton({ lines = 3, card = true, label = 'Loading' }) {
  return <div className={`pp-skeleton ${card ? 'pp-card' : ''}`} role="status" aria-label={label}>
    {Array.from({ length: lines }, (_, i) => <span key={i} className="pp-shimmer" style={{ width: `${[72, 92, 56, 84, 64][i % 5]}%` }}/>)}
  </div>
}

export function EmptyState({ icon = null, title, text, children }) {
  return <div className="pp-empty pp-card pp-fade">
    {icon && <span className="pp-empty-icon" aria-hidden="true"><Icon name={icon} size={22}/></span>}
    <h3>{title}</h3>
    {text && <p>{text}</p>}
    {children && <div className="pp-empty-actions">{children}</div>}
  </div>
}

export function ErrorState({ text, onRetry }) {
  return <div className="pp-error pp-card pp-fade" role="alert">
    <Icon name="alert" size={20}/>
    <div><b>Something went wrong</b><p>{text || 'This could not be loaded.'}</p></div>
    {onRetry && <Button size="sm" variant="soft" onClick={() => onRetry()}>Try again</Button>}
  </div>
}

export function PageHead({ eyebrow, title, text, actions }) {
  return <header className="pp-head pp-head-compact pp-fade">
    <div className="pp-head-title">{eyebrow && <p className="pp-eyebrow">{eyebrow}</p>}<h1>{title}</h1>{text && <p className="pp-lead sr-only">{text}</p>}</div>
    {actions && !(React.isValidElement(actions) && actions.type === RefreshButton && !actions.props.recovery) && <div className="pp-head-actions">{actions}</div>}
  </header>
}

const TONES = { Confirmed: 'ok', Completed: 'ok', Paid: 'ok', Pending: 'wait', Issued: 'due', Cancelled: 'off', 'No-show': 'off' }
export function Pill({ children, tone }) {
  return <span className={`pp-pill ${tone || TONES[children] || 'info'}`}>{children === 'Issued' ? 'Payment due' : children}</span>
}
