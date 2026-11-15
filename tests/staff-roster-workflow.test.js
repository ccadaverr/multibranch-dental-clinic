import test from 'node:test'
import assert from 'node:assert/strict'
import {validRoster,confirmedRoster} from '../src/staff-roster-workflow.js'
const row={id:'r',staff_ref:'s',date:'2026-11-16',branch_ref:'b',revision:3,status:'Published',published:true,kind:'weekly',weekdays:[1],exceptions:[],publication_id:'p',published_revision:3}
const command={action:'publish',reviewed:{id:'r',branch_ref:'b'},body:{date:row.date,expected_revision:2,operation_id:'op'}}
const response={ok:true,data:row,meta:{operation_id:'op',replayed:false}}
test('publication completion requires exact Staff/date/revision, lifecycle and durable publication identity',()=>{
  assert.equal(confirmedRoster(response,'s',command),true)
  assert.equal(confirmedRoster({...response,meta:{...response.meta,replayed:true}},'s',command),true)
  for(const patch of [{id:'foreign'},{branch_ref:'foreign'},{staff_ref:'foreign'},{date:'2026-11-17'},{revision:4},{status:'Approved'},{published:false},{publication_id:null},{published_revision:2}])assert.equal(confirmedRoster({...response,data:{...row,...patch}},'s',command),false)
  assert.equal(confirmedRoster({...response,meta:{operation_id:'foreign',replayed:false}},'s',command),false)
})
test('drafts and pending requests are never accepted as published duty',()=>{
  for(const status of ['Draft','Pending','Approved'])assert.equal(validRoster({...row,status,published:true},'s',row.date),false)
  assert.equal(validRoster({...row,status:'Pending',published:false},'s',row.date),true)
  assert.equal(confirmedRoster({...response,data:{...row,status:'Pending',published:false}},'s',command),false)
})
test('saved exception receipts compare JSON values independently of PostgreSQL object key order',()=>{
  const body={date:row.date,branch_ref:'b',kind:'weekly',effective_from:row.date,effective_until:'2026-11-30',start_time:'09:00',end_time:'17:00',weekdays:[1],exceptions:[{date:'2026-11-23',kind:'day_off',start_time:null,end_time:null}],expected_revision:0,operation_id:'save'}
  const saved={...row,...body,id:'r',revision:1,status:'Pending',published:false,exceptions:[{end_time:null,kind:'day_off',date:'2026-11-23',start_time:null}]}
  const result={ok:true,data:saved,meta:{operation_id:'save',replayed:false}},save={action:'save',body}
  assert.equal(confirmedRoster(result,'s',save),true)
  assert.equal(confirmedRoster({...result,data:{...saved,exceptions:[]}},'s',save),false)
})
