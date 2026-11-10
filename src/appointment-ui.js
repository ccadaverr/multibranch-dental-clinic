import { useLayoutEffect, useRef, useState } from 'react'
import { inScope } from './contracts.js'
import { canAccessPage } from './safeguards.js'
import { clinicDate } from './clock.js'

// UI request ownership only. Server authorization, revisions and idempotency remain authoritative.
export function schedulingActorKey(store) {
  const s = store.session, state = store.state || {}
  const user = state.users?.find(row => row.id === s?.userId)
  const staff = state.staff?.find(row => row.userId === s?.userId)
  const canonical = rows => Array.isArray(rows) ? [...new Set(rows)].sort() : null
  return JSON.stringify([store.getAuthGeneration?.(), canSchedule(store), s?.serverUserId, s?.userId, s?.role, s?.active, s?.expiresAt, s?.branchId,
    s?.scopeBranchId, s?.role === 'owner' ? null : canonical(s?.branchScopes), user?.status, user?.accountStatus,
    user?.role, user?.roleName, user?.personId, user?.branchId, canonical(user?.permissions),
    staff?.personId, staff?.branchId])
}

export function canSchedule(store, branchId = null) {
  const { session, state } = store
  if (!session?.serverUserId || !['staff', 'owner'].includes(session.role)) return false
  if (store.getAuthGeneration && store.getAuthGeneration() == null) return false
  if (!Array.isArray(state?.users) || !Array.isArray(state?.persons) || !Array.isArray(state?.staff)) return false
  return canAccessPage(state, session, 'calendar') && (!branchId || inScope({ branchId }, session, state))
}

export function appointmentActionProblem(store, appointment, action = 'reschedule') {
  if (!appointment?.id || !canSchedule(store, appointment.branchId)) return 'Your appointment access changed. Refresh before continuing.'
  if (!['Confirmed', 'Pending'].includes(appointment.status)) return 'This appointment can no longer be changed. Refresh the appointment list.'
  if (action === 'noShow' && appointment.date !== clinicDate()) return 'Only today’s appointments can be marked No-show.'
  const current = store.state.appointments.find(row => row.id === appointment.id)
  if (current && (current.revision > appointment.revision || current.status !== appointment.status ||
    ['patientPublicId', 'branchId', 'serviceId', 'dentistId'].some(key => current[key] != null && appointment[key] != null && current[key] !== appointment[key]))) {
    return 'This appointment changed. Close this form, refresh and review it again.'
  }
  return ''
}

// The ref guard takes effect before React renders disabled controls. Each context transition
// gets a new generation, so A→B→A cannot revive A's old response. Invalidation never cancels a command.
export function useRequestOwner(context, getAuthGeneration = null) {
  const state = useRef({ live: false, generation: 0, pending: null })
  const [busy, setBusy] = useState(false)
  useLayoutEffect(() => {
    const owner = state.current
    owner.live = true; owner.generation++; owner.pending = null; setBusy(false)
    return () => { owner.live = false; owner.generation++ }
  }, [context])
  return {
    busy,
    isPending() { return !!state.current.pending },
    begin() {
      const owner = state.current
      if (!owner.live || owner.pending) return null
      const auth = getAuthGeneration?.()
      if (getAuthGeneration && auth == null) return null
      const ticket = { generation: owner.generation, auth }
      owner.pending = ticket; setBusy(true)
      return ticket
    },
    current(ticket) { return state.current.live && ticket?.generation === state.current.generation && ticket.auth === getAuthGeneration?.() },
    invalidate() { state.current.generation++ },
    finish(ticket) {
      if (state.current.pending !== ticket) return
      state.current.pending = null
      if (state.current.live) setBusy(false)
    },
  }
}
