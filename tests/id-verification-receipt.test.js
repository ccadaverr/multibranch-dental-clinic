import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
const source=readFileSync(new URL('../src/pages/CounterIntake.jsx',import.meta.url),'utf8')
const from=source.indexOf('const ID_TYPES ='),to=source.indexOf('/** One click at Check-In',from)
const matches=runInNewContext(source.slice(from,to)+'\nidReceiptMatches')
const body={id_type:'other',other_details:'Synthetic barangay ID'},receipt={patient_id:'exact-patient',id_type:'other',other_details:'Synthetic barangay ID',id_verified_at:'2026-11-15T12:00:00+08:00'}
test('ID verification receipt names the exact selected Patient',()=>assert.equal(matches(body,receipt,'exact-patient'),true))
for(const [name,patch] of [['another Patient',{patient_id:'other-patient'}],['missing Patient',{patient_id:undefined}],['wrong type',{id_type:'philid'}],['different Other',{other_details:'Other identity'}],['missing timestamp',{id_verified_at:null}]])test('ID check refuses '+name,()=>assert.equal(matches(body,{...receipt,...patch},'exact-patient'),false))
test('Other still requires nonblank specific identity type',()=>assert.equal(matches({id_type:'other',other_details:'   '},{...receipt,other_details:'   '},'exact-patient'),false))
