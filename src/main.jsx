import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'
import './foundation.css'
import './patient.css'
import './public-site.css'
import './polish.css'
import './patient/portal.css'
import './landing.css'
import './automations.css'
import './clinic-workflows.css'
import './unified-workspace-r17.css'

import { loadBranding } from './clinic-config.js'

// White-label: the Owner's clinic name, contact and logo are applied before the first render (fallback after 2.5 s).
const apiBase = import.meta.env?.VITE_API_BASE_URL || 'http://localhost:8000'
loadBranding(apiBase).finally(() => createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>))
