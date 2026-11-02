import React, { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button, Modal } from './components.jsx'

// App-owned, memory-only navigation guard. Security sign-out bypasses it deliberately.
export const ClinicalNavigation = createContext(null)
export function useClinicalNavigation(identity) {
  const guard = useRef(null), pending = useRef(null)
  const [open, setOpen] = useState(false)
  const register = React.useCallback(value => { guard.current = value; return () => { if (guard.current === value) guard.current = null } }, [])
  useEffect(() => { pending.current = null; setOpen(false) }, [identity])
  const request = action => {
    if (guard.current?.current?.dirty || guard.current?.current?.busy) { pending.current = action; setOpen(true); return false }
    action(); return true
  }
  const close = () => { pending.current = null; setOpen(false) }
  const dialog = <Modal open={open} title="Leave this encounter?" onClose={close}>
    <p>Your unsaved documentation is kept only on this screen. Stay to save it before leaving. A page refresh cannot recover unsaved work.</p>
    <div className="row-actions"><Button onClick={close}>Stay with encounter</Button><Button variant="ghost" onClick={() => {
      if (guard.current?.current?.busy) return
      const action = pending.current; close(); guard.current = null; action?.()
    }}>Discard unsaved changes and leave</Button></div>
    <p role="status">If a command is still running, wait for its result before leaving.</p>
  </Modal>
  return { register, request, dialog }
}
export function useClinicalProtection(dirty, busy) {
  const register = useContext(ClinicalNavigation), current = useRef({ dirty, busy })
  current.current = { dirty, busy }
  useLayoutEffect(() => register?.(current), [register])
  useEffect(() => {
    const warn = event => { if (current.current.dirty || current.current.busy) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])
}
