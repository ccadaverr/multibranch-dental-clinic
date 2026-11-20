import { useEffect, useRef, useState } from 'react'
import { loadBookingDraft, saveBookingDraft } from '../api-client.js'

// The portal remounts this hook when the authenticated patient changes.
export function useBookingDraft(selection, owns) {
  const [saved, setSaved] = useState(null)
  const [status, setStatus] = useState('Loading draft…')
  const revision = useRef(null), tail = useRef(Promise.resolve()), blocked = useRef(false)
  const latestWrite = useRef(0)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let mounted = true
    loadBookingDraft().then(result => {
      if (!mounted || !owns()) return
      if (!result.ok) { setStatus('Your saved draft could not be checked. Reload before confirming a booking.'); return }
      revision.current = result.data.revision
      setSaved(result.data.selection)
      setReady(!result.data.selection)
      setStatus('')
    })
    return () => { mounted = false }
  }, [])

  function write(next) {
    if (revision.current === null || blocked.current) return Promise.resolve(false)
    const sequence = ++latestWrite.current
    setStatus('Saving…')
    const operation = tail.current.then(async () => {
      if (blocked.current || !owns()) return false
      const result = await saveBookingDraft(revision.current, next, owns)
      if (!owns()) return false
      if (!result.ok) {
        blocked.current = true
        setStatus(result.message || 'Draft save unconfirmed. Reload to review your saved draft.')
        return false
      }
      revision.current = result.data.revision
      if (sequence === latestWrite.current) setStatus(next ? 'Saved' : '')
      return true
    })
    tail.current = operation
    return operation
  }

  const fingerprint = JSON.stringify(selection)
  useEffect(() => {
    if (ready && selection) write(selection)
  }, [ready, fingerprint])

  function resume() { setSaved(null); setReady(true) }
  async function discard() { if (await write(null)) resume() }
  return { saved, status, resume, discard, checkpoint: async () => {
    await tail.current
    if (blocked.current) throw new Error('Reload to review your saved draft before booking.')
    if (!ready || revision.current == null || revision.current < 1) throw new Error('Your draft has not been saved. Reload to check its status before booking.')
    return revision.current
  } }
}
