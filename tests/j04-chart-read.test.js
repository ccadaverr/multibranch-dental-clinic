import test from 'node:test'
import assert from 'node:assert/strict'
import {clinicalChartValid,readClinicalChart} from '../src/chart-read.js'
const finding=(id,tooth='16',status='Caries',surfaces=['O'])=>({id,tooth,status,surfaces,recorded_on:'2026-11-17',dentist:'Synthetic Dentist',note:'Synthetic observation',branch:{id:'b1',name:'Synthetic branch'},treatment_id:'t1',visit_id:'v1'})
const history=[finding('old','16','Caries',['M','O']),finding('new','16','Filled',['M'])]
const chart={patient:{id:'p1',name:'Synthetic Patient'},settings:{numbering:'fdi',statuses:['Caries','Filled','Sound']},surfaces:['M','O','D','B','L'],current:[{...history[0],surfaces:['O']},history[1]],history,tooth_revisions:{16:2},summary:[{status:'Caries',count:1,teeth:[{tooth:'16',surfaces:['O']}]},{status:'Filled',count:1,teeth:[{tooth:'16',surfaces:['M']}]}]}
test('chart projection preserves partial active surfaces and original immutable history',()=>{const before=JSON.stringify(chart);assert.equal(clinicalChartValid(chart,'p1'),true);assert.equal(JSON.stringify(chart),before);assert.deepEqual(chart.history[0].surfaces,['M','O'])})
test('chart refuses foreign Patients, invalid FDI/surfaces, duplicate history, false summary and incorrect revisions',()=>{
 const cases=[{patient:{id:'foreign'}},{current:[{...history[0],tooth:'19'}]},{current:[{...history[0],surfaces:['X']}]},{history:[...history,history[0]]},{tooth_revisions:{16:1}},{current:[{...chart.current[0],treatment_id:'foreign'},chart.current[1]]},{summary:[]},{summary:[{status:'Caries',count:99,teeth:[]}]}]
 for(const patch of cases)assert.equal(clinicalChartValid({...chart,...patch},'p1'),false)
})
test('baseline is distinct from an unrecorded tooth, and unknown saved condition text is retained',()=>{
 const e=finding('sound','55','Sound',[]),baseline={...chart,current:[e],history:[e],summary:[],tooth_revisions:{55:1}}
 assert.equal(clinicalChartValid(baseline,'p1'),true)
 const custom=finding('custom','85','Clinic observation',[])
 assert.equal(clinicalChartValid({...baseline,current:[custom],history:[custom],tooth_revisions:{85:1},summary:[{status:custom.status,count:1,teeth:[{tooth:'85',surfaces:[]}]}]},'p1'),true)
})
test('Staff read-only chart without note metadata remains valid; no write capability is inferred',()=>{const strip=({note,branch,treatment_id,visit_id,...e})=>e;assert.equal(clinicalChartValid({...chart,current:chart.current.map(strip),history:history.map(strip),tooth_revisions:undefined},'p1'),true)})
test('chart read timeout, rejection and stale completion are explicit failures',async()=>{
 assert.equal((await readClinicalChart(()=>new Promise(()=>{}),'p1',()=>true,5)).ok,false)
 assert.equal((await readClinicalChart(()=>{throw Error('offline')},'p1',()=>true)).ok,false)
 let current=true,release;const pending=readClinicalChart(()=>new Promise(r=>release=r),'p1',()=>current);await Promise.resolve();current=false;release({ok:true,data:chart});assert.equal((await pending).kind,'stale_context')
 let calls=0;assert.equal((await readClinicalChart(()=>{calls++;return {ok:true,data:chart}},'p1',()=>false)).ok,false);assert.equal(calls,0)
})
test('chart picker reads every authorized Visit page, keeps canonical Patient code and deduplicates Patients',async()=>{
 const {readChartVisitPatients}=await import('../src/chart-read.js'),calls=[],v={id:'v1',patient:{id:'p1',code:'PAT-1',name:'Synthetic Patient'},dentist:{id:'d1'},branch:{id:'b1',name:'Synthetic branch'}}
 const r=await readChartVisitPatients(async p=>{calls.push(p);return {ok:true,data:[p.page===1?v:{...v,id:'v2'}],meta:{current_page:p.page,last_page:2}}},{dentistId:'d1',from:'2026-10-18',to:'2026-11-17'},()=>true)
 assert.equal(r.ok,true);assert.deepEqual(r.data,[v.patient]);assert.equal(calls.length,2);assert.equal(calls[1].page,2)
 for(const patch of [{dentist:{id:'foreign'}},{patient:{id:'p1',name:'Missing code'}},{branch:null}])assert.equal((await readChartVisitPatients(async()=>({ok:true,data:[{...v,...patch}],meta:{current_page:1,last_page:1}}),{dentistId:'d1'},()=>true)).ok,false)
})
test('chart picker errors and bounded stale pages are never presented as a verified empty result',async()=>{
 const {readChartVisitPatients}=await import('../src/chart-read.js')
 assert.equal((await readChartVisitPatients(async()=>({ok:false,kind:'forbidden'}),{dentistId:'d1'},()=>true)).kind,'forbidden')
 let release,calls=0;const r=await readChartVisitPatients(()=>{calls++;return new Promise(resolve=>release=resolve)},{dentistId:'d1'},()=>true,5);assert.equal(r.ok,false);release({ok:true,data:[],meta:{last_page:2}});await new Promise(r=>setImmediate(r));assert.equal(calls,1)
})
