import test from 'node:test'
import assert from 'node:assert/strict'
import {boundedClinicalRead,clinicalHistoryMatches} from '../src/clinical-history.js'
const row={id:'t1',patient:{id:'p1'},status:'Completed',visit:{id:'v1',status:'Completed'},branch:{id:'b1'},dentist:{id:'d1'},revision:3,completed_at:'2026-09-28T10:00:00+08:00',procedures:[],clinical_notes:'Synthetic history'}
test('historical detail requires exact Patient/encounter and a full completed clinical projection',()=>{assert(clinicalHistoryMatches(row,'p1','t1'));for(const patch of [{patient:{id:'p2'}},{id:'t2'},{status:'In Treatment'},{visit:{id:'v2',status:'In Treatment'}},{revision:0},{completed_at:null}])assert.equal(clinicalHistoryMatches({...row,...patch},'p1','t1'),false);const {clinical_notes,...owner}=row;assert.equal(clinicalHistoryMatches(owner,'p1','t1'),false)})
test('failed and bounded history reads do not become successful empty history',async()=>{assert.equal((await boundedClinicalRead(()=>{throw Error('synthetic')})).ok,false);assert.equal((await boundedClinicalRead(()=>new Promise(()=>{}),5)).ok,false)})
