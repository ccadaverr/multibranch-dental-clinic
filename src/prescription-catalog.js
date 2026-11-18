import {boundedClinicalRead} from './clinical-history.js'

/** One read-only catalog per mounted actor/branch/Visit scope. Never authorizes a write. */
export function createPrescriptionCatalog(read, isCurrent) {
  let pending = null, known = null, serial = 0
  const stale = () => ({ok:false, kind:'stale_context', message:'The prescription context changed. Reload before continuing.'})
  return {
    invalidate() { serial++; pending = null; known = null },
    read() {
      if (!isCurrent()) return Promise.resolve(stale())
      if (known) return Promise.resolve(known)
      if (pending) return pending
      const ticket = serial, current = () => ticket === serial && isCurrent()
      pending = boundedClinicalRead(() => current() ? read() : stale()).then(result => {
        if (!current()) return stale()
        if (result?.ok && Array.isArray(result.data)) known = result
        return result
      }).finally(() => { if (ticket === serial) pending = null })
      return pending
    },
  }
}
