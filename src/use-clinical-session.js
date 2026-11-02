import { useEffect, useState } from 'react'
import { onSessionInvalidated } from './api-client.js'
import { validSession } from './safeguards.js'
import { clinicalSessionKey } from './encounter.js'
export function useClinicalSession(store) {
  const key = clinicalSessionKey(store.session)
  const [expired, setExpired] = useState(null)
  useEffect(() => onSessionInvalidated(() => setExpired(key)), [key])
  return expired !== key && store.session?.role === 'dentist' && !!store.session?.serverUserId && validSession(store.state, store.session)
}
