import test from 'node:test'
import assert from 'node:assert/strict'
import {dutyForBranch,dutyProjection} from '../src/work-hours-duty.js'

const day='2026-11-14',row={dentist_id:'d1',dentist_name:'Synthetic Dentist',branch_id:'b1',branch_name:'Synthetic Branch',on_duty_today:true,working_now:false,working_minutes:420,estimated:false}
const snapshot={date:day,as_of:day+'T10:00:00+08:00',rows:[row]}
test('STF-07 current dated source projection preserves separate duty and working-now facts',()=>{
 assert.deepEqual(dutyProjection(snapshot,day,['b1']),snapshot)
 assert.equal(dutyProjection(snapshot,day,['b1']).rows[0].working_now,false)
 assert.equal(dutyForBranch(snapshot,'d1','b1',day),'on')
})
test('STF-07 legitimate off-duty and profile estimate remain supported',()=>{
 const off={...snapshot,rows:[{...row,on_duty_today:false,working_now:false,working_minutes:0,estimated:true}]}
 assert.equal(dutyProjection(off,day,['b1']).rows[0].on_duty_today,false)
 assert.equal(dutyProjection(off,day,['b1']).rows[0].estimated,true)
 assert.equal(dutyForBranch(off,'d1','b1',day),'off')
})
for(const [name,patch]of [
 ['string duty',{on_duty_today:'false'}],['missing duty',{on_duty_today:undefined}],['null duty',{on_duty_today:null}],['string working',{working_now:'false'}],['missing working',{working_now:undefined}],['contradictory working',{on_duty_today:false,working_now:true,working_minutes:0}],['minutes contradiction',{on_duty_today:false}],['zero minutes contradiction',{working_minutes:0}],['negative minutes',{working_minutes:-1}],['fractional minutes',{working_minutes:1.5}],['unsafe minutes',{working_minutes:9007199254740992}],['missing estimate',{estimated:undefined}],['string estimate',{estimated:'false'}],['missing identity',{dentist_id:undefined}],['missing branch',{branch_id:null}],['empty identity',{dentist_id:''}],['missing name',{dentist_name:null}],['missing branch name',{branch_name:''}]
])test('STF-07 malformed '+name+' stays unavailable',()=>assert.equal(dutyProjection({...snapshot,rows:[{...row,...patch}]},day,['b1']),null))
for(const patch of [{date:'2026-11-13'},{as_of:123},{as_of:null},{as_of:'not-a-date'},{as_of:'2026-11-13T10:00:00+08:00'},{rows:null}])test('STF-07 malformed or stale envelope '+JSON.stringify(patch),()=>assert.equal(dutyProjection({...snapshot,...patch},day,['b1']),null))
test('STF-07 duplicate same-pair evidence is unknown in both schedule and Operations views',()=>{
 const duplicate={...snapshot,rows:[row,{...row,on_duty_today:false,working_minutes:0}]}
 assert.equal(dutyProjection(duplicate,day,['b1']),null)
 assert.equal(dutyForBranch(duplicate,'d1','b1',day),'unknown')
 assert.equal(dutyForBranch({...snapshot,rows:[row,row]},'d1','b1',day),'unknown')
})
test('STF-07 branch identity cannot be substituted by an identical display name',()=>{
 const other={...row,branch_id:'b2',dentist_name:'PRIVATE FOREIGN DENTIST'}
 const own=dutyProjection({...snapshot,rows:[row,other]},day,['b1'])
 assert.deepEqual(own.rows,[row]);assert.doesNotMatch(JSON.stringify(own),/PRIVATE FOREIGN/)
 assert.deepEqual(dutyProjection(snapshot,day,[]).rows,[])
 assert.equal(dutyProjection(snapshot,day,null),null)
})
test('STF-07 missing pair or stale date never infers availability',()=>{
 assert.equal(dutyForBranch(snapshot,'d1','b2',day),'unknown')
 assert.equal(dutyForBranch(snapshot,'d1','b1','2026-11-15'),'unknown')
 assert.equal(dutyForBranch({...snapshot,rows:[null]},'d1','b1',day),'unknown')
})
