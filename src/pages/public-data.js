import { useEffect, useSyncExternalStore } from 'react'
import { loadPublicBranches, loadPublicList } from '../clinic-config.js'
import { hasClinicCoordinates } from '../clinic-map-options.js'

// Public website data, loaded once per page view and shared by every section (branches, services, confirmed FAQ).
// States: {status: 'loading' | 'ready' | 'error', rows}. Nothing is invented when the server cannot be reached.
const loaders = {
  branches: () => loadPublicBranches().then(r => ({ ok: r.ok, rows: r.branches })),
  services: () => loadPublicList('services'),
  faq: () => loadPublicList('faq'),
}

const publicData = Object.fromEntries(Object.entries(loaders).map(([kind, load]) => {
  const listeners = new Set()
  let state = { status: 'loading', rows: [] }
  let pending = null
  const publish = (next) => {
    state = next
    listeners.forEach(listener => listener())
  }
  const reload = () => {
    if (pending) return pending
    pending = Promise.resolve().then(load).catch(() => ({ ok: false })).then(result => {
      pending = null
      publish({ status: result.ok ? 'ready' : 'error', rows: result.rows || [] })
    })
    if (state.status !== 'loading') publish({ status: 'loading', rows: [] })
    return pending
  }
  return [kind, {
    reload,
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }]
}))

export function usePublicData(kind) {
  const { getSnapshot, subscribe, reload } = publicData[kind]
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  useEffect(() => {
    if (getSnapshot().status !== 'ready') reload()
  }, [getSnapshot, reload])
  return { ...state, reload }
}

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2, minimumFractionDigits: 0 })

export function catalogEstimate(price) {
  if (price?.currency !== 'PHP' || !Number.isSafeInteger(price.amount_centavos) || price.amount_centavos < 0 || price.provisional !== true) return ''
  return `${price.kind === 'starting' ? 'From ' : ''}${peso.format(price.amount_centavos / 100)}${price.unit ? ` per ${price.unit}` : ''}`
}

/** Google Maps directions to a branch: its stored coordinates when present, otherwise its address as given. */
export const directionsUrl = branch => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(hasClinicCoordinates(branch) ? `${branch.latitude},${branch.longitude}` : branch.address)}`

/** "0922 878 7341" -> "+639228787341" for tel: links. */
export const telHref = phone => { const d = String(phone || '').replace(/[^0-9+]/g, ''); return `tel:${d.startsWith('+') ? d : d.startsWith('0') ? `+63${d.slice(1)}` : d}` }
