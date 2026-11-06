import assert from 'node:assert/strict'

// Authored, NOT RUN. This route supplies an isolated synthetic page without editing
// the read-only HND-UI-01/HND-TEST-01 fixtures. All API work stays in window.fetch.
const fixtureHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>HND-UI-02 synthetic recovery</title></head><body><main id="root"></main><script type="module">
import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import {flushSync} from 'react-dom'
import {HandoverDialog} from '/src/pages/Handovers.jsx'
import '/src/styles.css'
import '/src/foundation.css'
const options=JSON.parse(new URLSearchParams(location.search).get('options')||'{}')
const make=id=>({id:'handover-'+id,patient:{id:'patient-'+id,name:'Synthetic Patient '+id.toUpperCase()},from:{branch:{id:'a',name:'Synthetic sending branch'}},to:{branch:{id:'b',name:'Synthetic receiving branch'}},side:options.side||'receiving',status:options.status||'Sent',can_acknowledge:options.side!=='sending'&&options.auto!==false,can_cancel:options.side==='sending',created_at:'2026-11-06T08:00:00+08:00',summary:'PRIVATE SUMMARY '+id.toUpperCase(),notes:'PRIVATE NOTES '+id.toUpperCase(),documents:[{id:'doc-'+id,title:'PRIVATE TITLE '+id.toUpperCase()}]})
const records={a:make('a'),b:make('b')}
const f=window.hndUi02={reads:[],posts:[],feedback:[],gets:[],acks:[],changed:0,failGets:options.failGets||0,holdGet:!!options.holdGet,holdAck:!!options.holdAck,rejectAck:!!options.rejectAck,reconcileFails:false,terminalAfterConflict:options.terminalAfterConflict||null}
async function reply(queue,hold,payload,status=200){
 const entry={payload:structuredClone(payload),status,release:null}
 const pending=new Promise(resolve=>{entry.release=resolve});queue.push(entry)
 if(hold)await pending
 return Response.json(entry.payload,{status:entry.status})
}
window.fetch=async(url,options={})=>{
 const path=new URL(url,location.href).pathname,method=options.method||'GET'
 if(path==='/sanctum/csrf-cookie')return new Response(null,{status:204})
 const id=path.split('/')[3]?.replace('handover-',''),record=records[id]
 if(method==='GET'){
  f.reads.push(path)
  if(f.session.role==='staff'&&!f.session.branchScopes.length)return Response.json({message:'Synthetic receiving scope revoked'},{status:403})
  if(f.failGets>0){f.failGets--;return Response.json({message:'Synthetic first detail failure'},{status:503})}
  if(!record)return Response.json({message:'Synthetic missing handover'},{status:404})
  return reply(f.gets,f.holdGet,{data:record})
 }
 f.posts.push(path)
 if(path.endsWith('/acknowledge')){
  if(f.rejectAck){
   if(f.terminalAfterConflict)Object.assign(record,{status:f.terminalAfterConflict,can_acknowledge:false,can_cancel:false})
   if(f.reconcileFails)f.failGets++
   return Response.json({message:'Synthetic concurrent transition refusal',errors:{status:['Another actor changed the handover.']}},{status:422})
  }
  const response={...record,status:'Acknowledged',can_acknowledge:false,can_cancel:false}
  const result=await reply(f.acks,f.holdAck,{data:response})
  Object.assign(record,response);return result
 }
 if(path.endsWith('/cancel')){
  if(record.status!=='Sent'||record.side!=='sending')return Response.json({message:'Synthetic cancellation refusal'},{status:422})
  Object.assign(record,{status:'Cancelled',can_cancel:false,can_acknowledge:false});return Response.json({data:record})
 }
 throw Error('Unexpected synthetic handover command')
}
function Fixture(){
 const role=options.role||'staff'
 const [session,setSession]=useState({userId:role,serverUserId:'server-'+role,role,active:true,branchId:'b',branchScopes:['b'],dentistId:'dentist'})
 const [selection,setSelection]=useState(null)
 f.session=session;f.setSession=patch=>flushSync(()=>setSession(old=>({...old,...patch})))
 f.select=id=>flushSync(()=>setSelection(id?{id:'handover-'+id,patientId:'patient-'+id}:null))
 const state={persons:['staff','dentist','owner','patient'].map(id=>({id:'person-'+id})),users:['staff','dentist','owner','patient'].map(id=>({id,personId:'person-'+id,role:id==='owner'?'Owner / Admin':id[0].toUpperCase()+id.slice(1),status:'Active',branchId:'b',permissions:['all']})),staff:[{userId:'staff',personId:'person-staff',branchId:'b'}],dentists:[{id:'dentist',userId:'dentist',personId:'person-dentist',branchIds:['b']}],patients:[]}
 const store={session,state,toast:(...args)=>f.feedback.push(args)}
 return React.createElement(React.Fragment,null,
  React.createElement('button',{onClick:()=>setSelection({id:'handover-a',patientId:'patient-a'})},'Open synthetic handover'),
  selection&&React.createElement(HandoverDialog,{store,...selection,toast:store.toast,onChanged:()=>{f.changed++},onClose:()=>setSelection(null)}))
}
createRoot(document.getElementById('root')).render(React.createElement(Fixture))
</script></body></html>`

export async function runHndUi02Recovery(page, base, runCase = async (_name, body) => body()) {
  const pattern = '**/tests/hnd-ui-02-recovery.synthetic.html*'
  const serve = route => route.fulfill({ contentType: 'text/html', body: fixtureHtml })
  await page.route(pattern, serve)
  const errors = [], onError = error => errors.push(error.message)
  page.on('pageerror', onError)
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const detail = () => page.getByRole('dialog', { name: 'Handover: Synthetic Patient A', exact: true })
  const setup = async (options = {}) => {
    errors.length = 0
    await page.goto(`${base}/tests/hnd-ui-02-recovery.synthetic.html?options=${encodeURIComponent(JSON.stringify(options))}`)
    await page.waitForFunction(() => window.hndUi02?.select)
    const opener = page.getByRole('button', { name: 'Open synthetic handover', exact: true })
    await opener.focus(); await page.keyboard.press('Enter')
  }
  const posts = () => page.evaluate(() => window.hndUi02.posts)
  try {
    await runCase('HND-UI-02 rendered first-open success and reopening Acknowledged do not duplicate transitions', async () => {
      await setup()
      await detail().getByRole('status').filter({ hasText: 'Handover acknowledged.' }).waitFor()
      assert.deepEqual(await posts(), ['/api/handovers/handover-a/acknowledge'])
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Open synthetic handover' }).click()
      await detail().getByText('PRIVATE NOTES A', { exact: true }).waitFor()
      assert.match(await detail().innerText(), /Acknowledged/)
      assert.equal((await posts()).length, 1)
    })
    await runCase('HND-UI-02 rendered failed first GET → keyboard Retry → one automatic acknowledgment', async () => {
      for (const role of ['staff','dentist']) {
        await setup({ role, failGets: 1, holdGet: true, holdAck: true })
        const retry = page.getByRole('button', { name: 'Retry handover', exact: true })
        await retry.waitFor()
        assert.equal((await posts()).length, 0)
        await retry.focus(); await page.keyboard.press('Enter')
        await page.waitForFunction(() => window.hndUi02.gets.length === 1)
        // Synchronous repeated clicks must not send another GET or transition.
        await page.evaluate(() => document.querySelectorAll('button').forEach(button => { if (button.textContent==='Retry handover') { button.click(); button.click() } }))
        assert.equal(await page.evaluate(() => window.hndUi02.reads.length), 2)
        await page.evaluate(() => window.hndUi02.gets[0].release())
        await page.waitForFunction(() => window.hndUi02.acks.length === 1)
        assert.equal((await posts()).length, 1)
        assert.deepEqual(await page.evaluate(() => window.hndUi02.feedback), [])
        assert.equal(await detail().getByRole('button', { name: 'Cancel handover', exact: true }).count(), 0)
        await page.evaluate(() => window.hndUi02.acks[0].release())
        await detail().getByRole('status').filter({ hasText: 'Handover acknowledged.' }).waitFor()
        assert.equal((await posts()).length, 1)
        await page.keyboard.press('Tab')
        assert.equal(await page.evaluate(() => !!document.activeElement.closest('dialog')), true)
        await page.keyboard.press('Escape')
        assert.equal(await page.getByRole('dialog').count(), 0)
        assert.equal(await page.getByRole('button', { name: 'Open synthetic handover' }).evaluate(node => node === document.activeElement), true)
        assert.deepEqual(errors, [])
      }
    })
    await runCase('HND-UI-02 rendered Retry accepts terminal server truth without auto-ack', async () => {
      for (const status of ['Acknowledged','Cancelled']) {
        await setup({ failGets: 1, status })
        await page.getByRole('button', { name: 'Retry handover', exact: true }).click()
        await detail().getByText('PRIVATE NOTES A', { exact: true }).waitFor()
        assert.match(await detail().innerText(), new RegExp(status))
        assert.deepEqual(await posts(), [])
      }
    })
    await runCase('HND-UI-02 rendered A→B→A pending detail GETs reject old Patient content', async () => {
      await setup({ holdGet: true, auto: false })
      await page.waitForFunction(() => window.hndUi02.gets.length === 1)
      await page.evaluate(() => window.hndUi02.select('b'))
      await page.waitForFunction(() => window.hndUi02.gets.length === 2)
      await page.evaluate(() => window.hndUi02.select('a'))
      await page.waitForFunction(() => window.hndUi02.gets.length === 3)
      await page.evaluate(() => { window.hndUi02.gets[2].payload.data.notes='CURRENT A'; window.hndUi02.gets[2].release() })
      await detail().getByText('CURRENT A', { exact: true }).waitFor()
      await page.evaluate(() => { window.hndUi02.gets[1].release(); window.hndUi02.gets[0].release() })
      await settle()
      assert.match(await detail().innerText(), /CURRENT A/)
      assert.doesNotMatch(await detail().innerText(), /PRIVATE NOTES A|PRIVATE NOTES B|PRIVATE TITLE B/)
    })
    await runCase('HND-UI-02 rendered account/scope replacement cannot adopt a pending acknowledgment', async () => {
      for (const change of ['account','scope']) {
        await setup({ holdAck: true })
        await page.waitForFunction(() => window.hndUi02.acks.length === 1)
        await page.evaluate(change => {
          if (change==='account') { window.hndUi02.failGets=1; window.hndUi02.setSession({serverUserId:'replacement-staff'}) }
          else window.hndUi02.setSession({branchScopes:[]})
        }, change)
        await page.getByRole('button', { name: 'Retry handover', exact: true }).waitFor()
        assert.equal(await page.getByText('PRIVATE NOTES A', { exact: true }).count(), 0)
        await page.evaluate(() => window.hndUi02.acks[0].release()); await settle()
        assert.equal(await page.getByText('PRIVATE NOTES A', { exact: true }).count(), 0)
        assert.deepEqual(await page.evaluate(() => window.hndUi02.feedback), [])
        assert.equal(await page.evaluate(() => window.hndUi02.changed), 0)
      }
    })
    await runCase('HND-UI-02 rendered conflicts and failed reconciliation preserve error/retry semantics', async () => {
      for (const status of ['Acknowledged','Cancelled']) {
        await setup({ rejectAck: true, terminalAfterConflict: status })
        await detail().getByRole('alert').filter({ hasText: 'Automatic acknowledgment was not confirmed.' }).waitFor()
        await detail().getByRole('status').filter({ hasText: `Latest server status: ${status}` }).waitFor()
        assert.equal((await posts()).length, 1)
        assert.deepEqual(await page.evaluate(() => window.hndUi02.feedback), [])
      }
      await setup({ failGets: 1, rejectAck: true })
      await page.evaluate(() => { window.hndUi02.reconcileFails=true })
      await page.getByRole('button', { name: 'Retry handover', exact: true }).click()
      await page.waitForFunction(() => window.hndUi02.posts.length===1 && window.hndUi02.reads.length===3)
      await page.getByRole('button', { name: 'Retry handover', exact: true }).waitFor()
      await page.evaluate(() => { window.hndUi02.rejectAck=false; window.hndUi02.reconcileFails=false })
      await page.getByRole('button', { name: 'Retry handover', exact: true }).click()
      await detail().getByRole('button', { name: 'Retry automatic acknowledgment', exact: true }).waitFor()
      assert.equal((await posts()).length, 1, 'retrieval retry only reconciles after a transition attempt')
      await detail().getByRole('button', { name: 'Retry automatic acknowledgment', exact: true }).click()
      await detail().getByRole('status').filter({ hasText: 'Handover acknowledged.' }).waitFor()
      assert.equal((await posts()).length, 2)
    })
    await runCase('HND-UI-02 rendered cancellation keeps explicit confirmation and sending-only authority', async () => {
      await setup({ side: 'sending' })
      const cancel = detail().getByRole('button', { name: 'Cancel handover', exact: true })
      await cancel.click()
      const confirmation = page.getByRole('dialog', { name: 'Cancel patient handover?', exact: true })
      await confirmation.waitFor(); assert.deepEqual(await posts(), [])
      await page.keyboard.press('Escape'); assert.deepEqual(await posts(), [])
      await cancel.click()
      await confirmation.getByRole('button', { name: 'Cancel handover', exact: true }).click()
      await detail().getByRole('status').filter({ hasText: 'Handover cancelled.' }).waitFor()
      assert.deepEqual(await posts(), ['/api/handovers/handover-a/cancel'])
      await setup({ side: 'sending', status: 'Acknowledged' })
      await detail().getByText('PRIVATE NOTES A', { exact: true }).waitFor()
      assert.equal(await detail().getByRole('button', { name: 'Cancel handover', exact: true }).count(), 0)
      assert.deepEqual(await posts(), [])
    })
    await runCase('HND-UI-02 rendered Owner metadata-only and Patient exclusion survive unexpected private responses', async () => {
      await setup({ role: 'owner' })
      await detail().waitFor()
      assert.doesNotMatch(await detail().innerText(), /PRIVATE|Retry automatic acknowledgment|Cancel handover/)
      assert.deepEqual(await posts(), [])
      await setup({ role: 'patient' })
      await page.getByText('This account cannot open the handover.', { exact: true }).waitFor()
      assert.equal(await page.evaluate(() => window.hndUi02.reads.length), 0)
      assert.equal(await page.getByText(/PRIVATE/).count(), 0)
    })
    await runCase('HND-UI-02 creation confirms recording without claiming notification delivery (existing fixture)', async () => {
      await page.goto(`${base}/tests/fixtures/hnd-ui-01-handovers.html`)
      await page.waitForFunction(() => window.hndUi01?.setSide)
      await page.evaluate(() => { window.hndUi01.setSide('sending'); window.hndUi01.setMode('patient') })
      await page.getByRole('button', { name: 'Hand over care', exact: true }).click()
      const form = page.getByRole('form', { name: 'Create Patient handover' })
      await form.getByLabel('From branch', { exact: true }).selectOption('b1')
      await form.getByLabel('To branch', { exact: true }).selectOption('b2')
      await form.getByLabel('Summary', { exact: true }).fill('Synthetic recovery regression')
      await form.getByRole('button', { name: 'Send handover', exact: true }).click()
      await page.getByRole('button', { name: 'Hand over care', exact: true }).waitFor()
      assert.deepEqual(await page.evaluate(() => window.hndUi01.feedback), [{ message: 'Handover recorded.', tone: 'success' }])
      assert.equal(await page.getByText(/receiving team was told|recipients? notified|notifications? delivered/i).count(), 0)
    })
  } finally {
    page.off('pageerror', onError)
    await page.unroute(pattern, serve)
  }
}
