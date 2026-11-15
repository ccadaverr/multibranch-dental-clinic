import test from 'node:test'
import assert from 'node:assert/strict'
import { validRosterDraft, rosterDraftReceipt } from '../src/staff-roster-draft.js'
const row={id:'draft-public',staff_ref:'s1',branch_ref:'b1',date:'2026-11-16',start_time:'09:00',end_time:'17:00',revision:1,status:'Draft',published:false}
const payload={date:row.date,branch_ref:'b1',start_time:'09:00',end_time:'17:00',expected_revision:0,operation_id:'operation'}
const result={ok:true,data:row,meta:{operation_id:'operation',replayed:false,publication_available:false}}
test('dated draft receipt is bound to Staff/date/branch/interval/revision and never published duty',()=>{
  assert.equal(rosterDraftReceipt(result,'s1',payload),true)
  for(const patch of [{staff_ref:'other'},{date:'2026-11-17'},{branch_ref:'b2'},{start_time:'10:00'},{revision:2},{published:true},{status:'Published'}])assert.equal(rosterDraftReceipt({...result,data:{...row,...patch}},'s1',payload),false)
  assert.equal(rosterDraftReceipt({...result,meta:{...result.meta,operation_id:'wrong'}},'s1',payload),false)
  assert.equal(rosterDraftReceipt({...result,meta:{...result.meta,publication_available:true}},'s1',payload),false)
  assert.equal(rosterDraftReceipt({...result,meta:{...result.meta,replayed:true}},'s1',payload),true)
})
test('invalid or absent draft evidence cannot supply a saved resource',()=>{
  assert.equal(validRosterDraft(null,'s1',row.date),false)
  for(const patch of [{end_time:'08:00'},{start_time:'25:00'},{revision:0},{revision:1.5},{branch_ref:''}])assert.equal(validRosterDraft({...row,...patch},'s1',row.date),false)
})
