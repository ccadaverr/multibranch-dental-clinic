// Bounds non-mutating Home dashboard reads even when a network mock or proxy
// ignores AbortSignal. A late response can never be accepted after the deadline.
export class HomeReadDeadlineError extends Error {
  constructor(message = 'This information took too long to load.') {
    super(message)
    this.name = 'HomeReadDeadlineError'
  }
}

export function startHomeRead(read, { timeoutMs = 12000, timeoutMessage } = {}) {
  if (typeof read !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('A read function and positive timeout are required.')
  }
  const controller = new AbortController()
  let rejectDeadline
  let settled = false
  const deadline = new Promise((_, reject) => { rejectDeadline = reject })
  const timer = setTimeout(() => {
    if (settled) return
    controller.abort()
    rejectDeadline(new HomeReadDeadlineError(timeoutMessage))
  }, timeoutMs)
  const response = Promise.race([Promise.resolve().then(() => read(controller.signal)), deadline])
    .finally(() => { settled = true; clearTimeout(timer) })
  return {
    response,
    cancel() {
      if (settled) return
      controller.abort()
      rejectDeadline(new HomeReadDeadlineError('Read cancelled.'))
    },
  }
}
