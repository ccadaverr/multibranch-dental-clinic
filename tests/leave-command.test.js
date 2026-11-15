import test from 'node:test'
import assert from 'node:assert/strict'
import {confirmedLeaveCommand,validLeaveRevision} from '../src/leave-command.js'
const command={action:'create',body:{operation_id:'synthetic-op',expected_revision:0,type:'other',start_date:'2028-02-29',end_date:'2028-02-29',private_note:'Synthetic reason'}}
const result={ok:true,data:{id:'synthetic-id',revision:1,status:'Pending',type:'other',starts_at:'2028-02-29T00:00:00+08:00',ends_at:'2028-03-01T00:00:00+08:00',private_note:'Synthetic reason'},meta:{operation_id:'synthetic-op',replayed:false}}
test('creation confirmation binds dates, type, note, resource revision and exact operation',()=>{
 assert.equal(confirmedLeaveCommand(command,result),true)
 for(const patch of [{revision:2},{status:'Approved'},{private_note:'other'},{ends_at:'2028-02-29T00:00:00+08:00'}])assert.equal(confirmedLeaveCommand(command,{...result,data:{...result.data,...patch}}),false)
 assert.equal(confirmedLeaveCommand(command,{...result,meta:{...result.meta,operation_id:'wrong'}}),false)
 assert.equal(confirmedLeaveCommand(command,{...result,meta:{...result.meta,replayed:true}}),true)
})
for(const [action,status] of [['approve','Approved'],['decline','Declined'],['cancel','Cancelled']])test(action+' confirms only the exact target and next observed revision',()=>{
 const c={action,id:'leave-a',body:{expected_revision:3,operation_id:'op-a'}},r={ok:true,data:{id:'leave-a',revision:4,status},meta:{operation_id:'op-a',replayed:true}}
 assert.equal(confirmedLeaveCommand(c,r),true)
 assert.equal(confirmedLeaveCommand(c,{...r,data:{...r.data,id:'leave-b'}}),false)
 assert.equal(confirmedLeaveCommand(c,{...r,data:{...r.data,revision:5}}),false)
})
test('missing or fabricated revision is not observed authority',()=>{for(const value of [null,undefined,0,-1,1.5,'1'])assert.equal(validLeaveRevision(value),false)})
