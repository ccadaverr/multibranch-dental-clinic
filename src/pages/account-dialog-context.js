import { createContext } from 'react'

// Share one context across the entry shell and lazily loaded account routes, including Fast Refresh.
export const InAccountDialog = createContext(false)
