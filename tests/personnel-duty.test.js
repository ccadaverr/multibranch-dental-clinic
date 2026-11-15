import test from 'node:test'
import assert from 'node:assert/strict'
import { personnelDutyRows } from '../src/personnel-duty.js'

const row = { dentist_id:'d1',branch_id:'b1',dentist_name:'Synthetic Doctor',branch_name:'Synthetic branch',on_duty_today:true,working_now:false,working_minutes:240,estimated:false }
const duty = {date:'2026-11-15',as_of:'2026-11-15T07:00:00+08:00',rows:[row]}
test('Owner personnel duty is dated and branch-specific, independent of profile availability',()=>{
  assert.equal(personnelDutyRows(duty,'d1',['b1'],'2026-11-15')[0].status,'on')
  assert.equal(personnelDutyRows({...duty,rows:[{...row,on_duty_today:false,working_minutes:0}]},'d1',['b1'],'2026-11-15')[0].status,'off')
  assert.equal(personnelDutyRows(duty,'d1',['b2'],'2026-11-15')[0].status,'unknown')
  assert.deepEqual(personnelDutyRows(duty,'d1',['b1'],'2026-11-16'),[])
  assert.deepEqual(personnelDutyRows(null,'d1',['b1'],'2026-11-15'),[])
})
test('Owner personnel refuses ambiguous/malformed duty and retains estimated fallback evidence',()=>{
  assert.deepEqual(personnelDutyRows({...duty,rows:[row,row]},'d1',['b1'],'2026-11-15'),[])
  assert.deepEqual(personnelDutyRows({...duty,as_of:'invalid'},'d1',['b1'],'2026-11-15'),[])
  assert.equal(personnelDutyRows({...duty,rows:[{...row,estimated:true}]},'d1',['b1'],'2026-11-15')[0].estimated,true)
})
