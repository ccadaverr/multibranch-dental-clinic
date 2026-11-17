import test from 'node:test'
import assert from 'node:assert/strict'
import {dutyProjection,dutyRowsForSelection} from '../src/work-hours-duty.js'

const row=(branch,doctor='d1',name='Synthetic branch')=>({dentist_id:doctor,dentist_name:'Synthetic Dentist',branch_id:branch,branch_name:name,on_duty_today:true,working_now:false,working_minutes:60,estimated:false})
const raw={date:'2026-11-17',as_of:'2026-11-17T09:00:00+08:00',rows:[row('b1'),row('b1','d2'),row('b2','d3')]}
test('Staff duty never combines distinct branch IDs sharing one selected name',()=>{
 const duty=dutyProjection(raw,raw.date,['b1','b2'])
 assert.equal(dutyRowsForSelection(duty,'Synthetic branch'),null)
 assert.equal(dutyRowsForSelection(duty,'All Branches').length,3)
})
test('Exact branch selection keeps all its Dentists and excludes namesakes outside current scope',()=>{
 const duty=dutyProjection(raw,raw.date,['b1'])
 assert.deepEqual(dutyRowsForSelection(duty,'Synthetic branch').map(r=>[r.dentist_id,r.branch_id]),[['d1','b1'],['d2','b1']])
 assert.deepEqual(dutyRowsForSelection(duty,'Unknown branch'),[])
 assert.deepEqual(dutyRowsForSelection(null,'All Branches'),[])
})
