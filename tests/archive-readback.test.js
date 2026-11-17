import test from 'node:test'
import assert from 'node:assert/strict'
import {loadInvoiceHistory,readOwnedArchive} from '../src/patient/archive-readback.js'
test('receipt history follows the real cursor; later-page failure and repeated cursors are explicit failures',async()=>{
 let pages=[];const read=async args=>{pages.push(args);return {ok:true,data:[{id:pages.length===1?'next':'last'}],meta:{next_cursor:pages.length===1?'next':null}}};assert.equal((await loadInvoiceHistory(read)).data.length,2);assert.equal(pages[1].cursor,'next');
 assert.equal((await loadInvoiceHistory(async args=>args.cursor?{ok:false}:{ok:true,data:[{id:'next'}],meta:{next_cursor:'next'}})).ok,false)
 assert.equal((await loadInvoiceHistory(async()=>({ok:true,data:[{id:'loop'}],meta:{next_cursor:'loop'}}))).ok,false)
})
test('timeout or changed ownership cannot dispatch another history page after a delayed response',async()=>{
 let release,calls=0;const result=await readOwnedArchive(guard=>loadInvoiceHistory(guard(async()=>{calls++;return new Promise(r=>{release=r})})),()=>true,5);assert.equal(result.ok,false);release({ok:true,data:[],meta:{next_cursor:'late'}});await new Promise(r=>setImmediate(r));assert.equal(calls,1)
 assert.equal((await readOwnedArchive(guard=>guard(async()=>{throw Error('must not dispatch')})(),()=>false)).ok,false)
})

test('invoice cursor must identify the last returned public record before another page is requested',async()=>{let calls=0;const r=await loadInvoiceHistory(async()=>{calls++;return {ok:true,data:[{id:'actual'}],meta:{next_cursor:'different'}}});assert.equal(r.ok,false);assert.equal(calls,1)})
