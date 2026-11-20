/**
 * One in-flight logout per active sign-out confirmation.
 * The caller owns the visible dialog until the authenticated logout promise settles.
 * A rejected transport may be retried; the application itself decides whether a
 * resolved logout invalidates only local auth or also confirms server revocation.
 */
export function createSignOutAttempt() {
  let pending = false
  return async (logout, update) => {
    if (pending) return false
    pending = true
    update({ pending: true, error: '', finished: false })
    try {
      await logout()
      update({ pending: false, error: '', finished: true })
      return true
    } catch {
      update({ pending: false, error: 'Sign-out could not finish. Check your connection and try again.', finished: false })
      return false
    } finally {
      pending = false
    }
  }
}
