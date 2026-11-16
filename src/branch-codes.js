import options from '../backend/resources/branch-code-options.json' with { type: 'json' }

export const BRANCH_CODE_OPTIONS = Object.freeze(options)

// Preserve an existing legacy code only for its own unchanged branch record.
export function isAllowedBranchCode(code, currentCode) {
  return typeof code === 'string' && code.length > 0 && code === code.trim() &&
    (BRANCH_CODE_OPTIONS.includes(code) || code === currentCode)
}
