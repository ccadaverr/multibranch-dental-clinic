// App-local ownership for authentication continuations, not server authorization.
// A new request supersedes the previous one; disposal/ABA never revives a ticket.
export function createAuthenticationOwner(readAuthGeneration) {
  let live = false, active = null
  return {
    activate() { live = true },
    invalidate() { active = null },
    dispose() { live = false; active = null },
    begin(callerCurrent = () => true, readGeneration = readAuthGeneration) {
      if (!live || !callerCurrent()) return null
      active = { generation:readGeneration(), readGeneration, callerCurrent }
      return active
    },
    current(ticket) {
      return live && ticket != null && active === ticket && ticket.callerCurrent()
        && ticket.readGeneration() === ticket.generation
    },
  }
}
