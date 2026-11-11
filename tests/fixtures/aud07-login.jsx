import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import App from '/src/App.jsx'
import { Login } from '/src/layout.jsx'
import * as api from '/src/api-client.js'
import * as data from '/src/data.js'
import '/src/styles.css'
import '/src/foundation.css'
import '/src/patient.css'
import '/src/public-site.css'
import '/src/polish.css'
import '/src/patient/portal.css'
import '/src/landing.css'
import '/src/automations.css'

// All requests stay in this synthetic fixture; no Laravel server is contacted.
const fixture = window.loginFixture = { callbacks:0, posts:[], probes:[], logout:0, logouts:[], throwCallback:false, holdMe:false, holdLogout:false }
fixture.invalidate = api.reportSessionInvalidated
const catalog = {
  '/api/branches':data.INITIAL_BRANCHES.map(b => ({id:b.id, name:b.name, branch_code:b.branchCode, city:b.city, address:b.address, phone:b.phone, open_time:b.open, close_time:b.close, status:b.status, capacity_threshold:b.threshold})),
  '/api/services':data.INITIAL_SERVICES.map(s => ({id:s.id, name:s.name, code:s.code, duration_minutes:s.duration, category:s.category, status:s.status})),
  '/api/branch-services':data.INITIAL_BRANCH_SERVICES.map(b => ({branch_ref:b.branchId, service_ref:b.serviceId, active:b.active})),
  '/api/dentists':data.INITIAL_DENTISTS.map(x => ({id:x.id, userId:x.userId, personId:x.personId, branch_ids:['b1'], shiftStart:x.shiftStart, shiftEnd:x.shiftEnd, available:x.available, service_ids:[]})),
  '/api/staff':data.INITIAL_STAFF.map(s => ({id:s.id, userId:s.userId, personId:s.personId, title:s.staffType, branchId:s.branchId || 'b1', shiftStart:s.shiftStart, shiftEnd:s.shiftEnd, available:s.available})),
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no }); return {promise,resolve,reject} }
window.fetch = async (url, options = {}) => {
  const path = new URL(url, location.href).pathname
  if (path === '/sanctum/csrf-cookie') return new Response(null, {status:204})
  if (path === '/api/login') {
    const request = deferred()
    // Count transport dispatch without retaining or printing credentials.
    fixture.posts.push(request)
    return request.promise
  }
  if (path === '/api/me') {
    if (fixture.holdMe || new URLSearchParams(location.search).has('holdBootstrap')) { const request=deferred();fixture.probes.push(request);return request.promise }
    return Response.json({message:'Unauthenticated'}, {status:401})
  }
  if (path === '/api/logout') {
    fixture.logout++
    if(fixture.holdLogout){const request=deferred();fixture.logouts.push(request);return request.promise}
    return new Response(null, {status:204})
  }
  return Response.json({data:catalog[path] || [], meta:{unread:0}, unread_count:0})
}
fixture.respond = (index, status=422, body={code:'invalid_credentials', message:'These credentials do not match our records.'}) => fixture.posts[index].resolve(Response.json(body, {status}))
fixture.refuseNetwork = index => fixture.posts[index].reject(new Error('Synthetic transport refusal'))
fixture.owner = {id:'synthetic-owner', email:'owner@example.test', role:'owner', account_status:'Active', branch_scopes:[]}
fixture.staff = {id:'synthetic-staff', email:'staff.reception@example.test', role:'staff', account_status:'Active', branch_scopes:[{id:'b1'}]}

function Fixture() {
  const [mounted,setMounted] = useState(true), [context,setContext] = useState(0)
  fixture.mount = value => flushSync(() => setMounted(value))
  fixture.replace = () => flushSync(() => setContext(value => value+1))
  const login = async (...args) => {
    fixture.callbacks++
    if (fixture.throwCallback) throw new Error('Synthetic callback failure; do not show exception details')
    return api.login(...args)
  }
  if (!mounted) return <p>Authentication screen unmounted</p>
  return new URLSearchParams(location.search).get('mode') === 'app' ? <App key={context}/> : <Login key={context} onLogin={login}/>
}
createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>)
