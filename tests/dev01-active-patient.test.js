import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { splitAppointments } from '../src/patient/format.js'
import { loadPatientAppointments, treatmentSummaries, visitFilter } from '../src/patient/visit-history.js'
const require = createRequire(import.meta.url)
const bundle = await build({ stdin: { contents: "export * from './src/patient/pages/Visits.jsx'; export * from './src/patient/pages/Book.jsx'", resolveDir: process.cwd() }, bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{name:'fixtures', setup(b) {
 b.onResolve({filter:/^react$/},()=>({path:pathToFileURL(require.resolve('react')).href,external:true}))
 b.onResolve({filter:/\/ui\.jsx$/},a=>a.importer.includes('pages')?{path:'fixture-ui',namespace:'fixture'}:undefined)
 b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export * from './src/patient/ui.jsx'; export function useLoad(){return globalThis.__dev01Loads.shift()}`,resolveDir:process.cwd()}))
}}] })
const pages=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'))
const ready=data=>({status:'ready',data,reload(){}})
const appointment=(id,status,date='2099-10-31')=>({id,status,date,starts_at:date+'T09:00:00+08:00',start_time:'09:00',service:{name:'Consultation'},branch:{name:'Recorded branch'},code:id})
function visits(tab,loads){ globalThis.__dev01Loads=[tab === 'upcoming' ? loads[0] : ready([]), tab === 'upcoming' ? ready([]) : loads[0], loads[1], loads[2]]; return renderToStaticMarkup(React.createElement(pages.VisitsPage,{context:{tab},onNavigate(){}})) }
test('active routed Visits renders future bookings as upcoming, not completed',()=>{
 const a=appointment('future','Confirmed')
 assert.match(visits('upcoming',[ready([a]),ready([]),ready([])]),/visit-future/)
 assert.doesNotMatch(visits('completed',[ready([a]),ready([]),ready([])]),/visit-future/)
})
test('completed and cancelled filters respect server lifecycle states',()=>{
 const rows=[appointment('done','Completed','2026-10-01'),appointment('cancel','Cancelled')]
 const html=visits('completed',[ready(rows),ready([]),ready([])])
 assert.match(html,/visit-done/); assert.doesNotMatch(html,/visit-cancel/)
 assert.match(visits('cancelled',[ready(rows),ready([]),ready([])]),/visit-cancel/)
})
test('History preserves two same-day treatment summaries without invented time or branch',()=>{
 const data=[{id:'a',date:'2026-10-01',procedure_summary:'First encounter'},{id:'b',date:'2026-10-01',procedure_summary:'Second encounter'}]
 const html=visits('history',[ready([]),ready(data),ready([])])
 assert.match(html,/First encounter/);assert.match(html,/Second encounter/)
 assert.doesNotMatch(html,/9:00 AM|Dr\. Dana Roxas Dental Clinic/)
 assert.equal(treatmentSummaries(data).length,2)
 assert.equal(visitFilter('archived'),'history')
})
test('Visits renders loading, empty and API error states without hiding errors',()=>{
 assert.match(visits('upcoming',[{status:'loading'},ready([]),ready([])]),/Loading your visits/)
 assert.match(visits('upcoming',[ready([]),ready([]),ready([])]),/No upcoming visits/)
 assert.match(visits('history',[{status:'error',error:'Range refused'}, {status:'error',error:'History unavailable'},ready([])]),/Range refused/)
 assert.match(visits('history',[ready([]),{status:'error',error:'History unavailable'},ready([])]),/History unavailable/)
})
test('active Book renders four-step progress and progressive service categories',()=>{
 globalThis.__dev01Loads=[ready([{id:'s',name:'Consultation',category:'General',status:'Active',online_booking:'bookable'}]),ready([])]
 const html=renderToStaticMarkup(React.createElement(pages.BookPage,{onNavigate(){}}))
 assert.match(html,/Date &amp; time/);assert.match(html,/<details/);assert.match(html,/<summary/)
 assert.doesNotMatch(html,/Choose a dentist/)
})
test('appointment list follows pagination and propagates later-page failures',async()=>{
 const seen=[]
 const r=await loadPatientAppointments(async p=>{seen.push(p);return {ok:true,data:[p.page],meta:{last_page:2}}})
 assert.deepEqual(r.data,[1,2]);assert.deepEqual(seen,[{per_page:100,page:1},{per_page:100,page:2}])
 const failed=await loadPatientAppointments(async p=>p.page===1?{ok:true,data:[1],meta:{last_page:2}}:{ok:false,message:'Offline'})
 assert.equal(failed.ok,false);assert.equal(failed.message,'Offline')
})
test('in-progress visits stay active and malformed timestamp cannot crash history',()=>{
 const now=new Date('2026-10-31T12:00:00+08:00')
 const r=splitAppointments([appointment('arrived','Checked In','2026-10-31'),{id:'missing',status:'Cancelled'}],now)
 assert.equal(r.upcoming[0].id,'arrived');assert.equal(r.past[0].id,'missing')
})

// R1: deterministic behavior tests for the same functions used by active Book.
