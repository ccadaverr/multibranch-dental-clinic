import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
import {readFile} from 'node:fs/promises'
const {chromium}=await import(pathToFileURL(process.argv[2]).href)
const browser=await chromium.launch({channel:'chrome',headless:true})
const base='http://127.0.0.1:5195/tests/fixtures/analytics-export-context.html'
const owner={id:'synthetic-owner',role:'owner',account_status:'Active'}
const row={id:'01j00000000000000000000001',action:'staff_roster.published',category:'administrative',severity:'info',actor:{name:'Synthetic Owner',role:'owner'},branch:{id:'b1',name:'Synthetic B1'},auditable_type:'StaffRosterDraft',auditable_id:'exact-roster',created_at:'2026-11-16T09:00:00+08:00'}
const results=[]
async function setup(mode='analytics',width=1440){
  const page=await browser.newPage({viewport:{width,height:1000}}),held=[],downloads=[],errors=[]
  let identity=owner,holdIdentity=false,heldIdentity
  // Deliberately ignore network abort. Production must still reject late data.
  await page.addInitScript(()=>{
    window.csvProbe={settled:0,signals:[]}
    const original=window.fetch.bind(window)
    window.fetch=async(input,options={})=>{
      const relevant=/\/api\/(?:analytics\/export|audit-logs\/export|me)(?:\?|$)/.test(String(input))
      if(!relevant)return original(input,options)
      window.csvProbe.signals.push(options.signal)
      const response=await original(input,{...options,signal:undefined})
      window.csvProbe.settled++
      return response
    }
  })
  page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('download',d=>downloads.push(d.suggestedFilename()))
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url())
    if(url.pathname.endsWith('/export')){
      let release;const gate=new Promise(r=>release=r),entry={url,release,status:200}
      held.push(entry);await gate
      await route.fulfill({status:entry.status,headers:{'Content-Type':'text/csv','Access-Control-Expose-Headers':'Content-Disposition','Content-Disposition':`attachment; filename="${mode}-${held.indexOf(entry)+1}.csv"`},body:`ID,Branch\nexact-roster-${held.indexOf(entry)+1},${url.searchParams.get('branch_id')||'all'}`})
    }else if(url.pathname==='/api/me'){
      if(holdIdentity)await new Promise(r=>heldIdentity=r)
      await route.fulfill({status:identity?200:503,json:identity?{data:identity}:{message:'Synthetic identity unavailable'}})
    }else if(url.pathname.startsWith('/api/audit-logs'))await route.fulfill({json:{data:[row],meta:{next_cursor:null}}})
    else await route.fulfill({status:503,json:{message:'Synthetic report unavailable'}})
  })
  await page.goto(base);await page.waitForFunction(()=>!!window.analyticsContext)
  await page.evaluate(mode=>{window.analyticsContext.setBranch('Synthetic B1');window.analyticsContext.setView(mode)},mode)
  const button=()=>page.getByRole('button',{name:mode==='analytics'?'Export Report CSV':/^(Export Audit Trail \(CSV\)|Generating Export\.\.\.)$/,exact:true})
  async function start(){await page.waitForFunction(mode=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===(mode==='analytics'?'Export Report CSV':'Export Audit Trail (CSV)')&&!b.disabled),mode);await button().focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>window.csvProbe.signals.length>0)}
  async function waitHeld(n){const until=Date.now()+10000;while(held.length<n&&Date.now()<until)await new Promise(r=>setTimeout(r,10));assert.equal(held.length,n)}
  async function settle(n){await page.waitForFunction(n=>window.csvProbe.settled>=n,n);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))}
  async function branch(name){await page.evaluate(name=>window.analyticsContext.setBranch(name),name);await page.waitForFunction(name=>window.analyticsContext.snapshot.branch===name,name)}
  async function close(){for(const e of held)e.release();heldIdentity?.();assert.deepEqual(errors,[]);await page.close()}
  return {page,held,downloads,button,start,waitHeld,settle,branch,close,identity:value=>identity=value,delayIdentity:()=>holdIdentity=true,releaseIdentity:()=>heldIdentity?.()}
}
try{
  for(const width of [390,1440]){
    const t=await setup('analytics',width)
    try{
      await t.start();await t.waitHeld(1)
      await t.branch('Synthetic B2');await t.branch('Synthetic B1')
      await t.start();await t.waitHeld(2)
      t.held[0].release();await t.settle(1)
      assert.deepEqual(t.downloads,[]);assert.equal(await t.button().isDisabled(),true)
      assert.equal(await t.page.getByRole('button',{name:'Cancel analytics export',exact:true}).isVisible(),true)
      const done=t.page.waitForEvent('download');t.held[1].release();const download=await done
      await t.page.getByText('Analytics CSV downloaded.',{exact:true}).waitFor()
      assert.deepEqual(t.downloads,['analytics-2.csv']);assert.equal(t.held[1].url.searchParams.get('branch_id'),'b1')
      assert.match(await readFile(await download.path(),'utf8'),/exact-roster-2,b1/)
      assert.equal(await t.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
      results.push(`analytics ${width}: A-B-A ownership, late aborted response, replacement busy state, keyboard, exact scope`)
    }finally{await t.close()}
  }
  for(const change of ['cancel','period','unmount','local authority','server role','server unavailable','delayed authority']){
    const t=await setup()
    try{
      if(change==='delayed authority')t.delayIdentity()
      await t.start();await t.waitHeld(1)
      if(change==='cancel')await t.page.getByRole('button',{name:'Cancel analytics export',exact:true}).click()
      if(change==='period')await t.page.getByRole('combobox',{name:'Report period',exact:true}).selectOption('This Week')
      if(change==='unmount')await t.page.evaluate(()=>window.analyticsContext.setView('away'))
      if(change==='local authority')await t.page.evaluate(()=>window.analyticsContext.invalidate())
      if(change==='server role')t.identity({...owner,role:'staff'})
      if(change==='server unavailable')t.identity(null)
      t.held[0].release();await t.settle(1)
      if(change==='delayed authority'){
        await t.page.waitForFunction(()=>window.csvProbe.signals.length===2)
        await t.page.getByRole('button',{name:'Cancel analytics export',exact:true}).click()
        t.releaseIdentity();await t.settle(2)
      }
      if(['server role','server unavailable'].includes(change))await t.page.getByRole('status').filter({hasText:'Owner authority could not be confirmed'}).waitFor()
      if(change==='local authority'){
        await t.page.getByText('Preparing analytics CSV…',{exact:true}).waitFor({state:'hidden'})
        assert.equal(await t.page.getByRole('button',{name:'Cancel analytics export',exact:true}).count(),0)
      }
      assert.deepEqual(t.downloads,[])
      assert.equal(await t.page.getByLabel('Export result',{exact:true}).textContent()==='Operational analytics CSV exported successfully.',false)
      results.push(`analytics: ${change} prevents download and success`)
    }finally{await t.close()}
  }
  // B owns the AuditTrail consumer; execute this part after its final READY handoff.
  if(process.argv.includes('--audit')){
    const t=await setup('audit')
    try{
      await t.page.getByRole('button',{name:'Inspect',exact:true}).click()
      await t.page.getByRole('button',{name:'Filter to this record',exact:true}).click()
      await t.page.getByRole('status').filter({hasText:'Record filter: StaffRosterDraft'}).waitFor()
      await t.start();await t.waitHeld(1)
      assert.equal(t.held[0].url.searchParams.get('target_id'),'exact-roster')
      await t.page.getByRole('button',{name:'Clear record filter',exact:true}).click()
      await t.start();await t.waitHeld(2)
      t.held[0].release();await t.settle(1);assert.deepEqual(t.downloads,[])
      assert.equal(await t.button().isDisabled(),true)
      const done=t.page.waitForEvent('download');t.held[1].release();await done
      assert.deepEqual(t.downloads,['audit-2.csv']);assert.equal(t.held[1].url.searchParams.has('target_id'),false)
      results.push('audit: exact record identity, filter supersession, late response and replacement ownership')
    }finally{await t.close()}
    for(const change of ['cancel','unmount','server role']){
      const t=await setup('audit')
      try{
        await t.start();await t.waitHeld(1)
        if(change==='cancel')await t.page.getByRole('button',{name:/Cancel audit export/i}).click()
        if(change==='unmount')await t.page.evaluate(()=>window.analyticsContext.setView('away'))
        if(change==='server role')t.identity({...owner,role:'staff'})
        t.held[0].release();await t.settle(1)
        if(change==='server role')await t.page.getByLabel('Export result',{exact:true}).filter({hasText:/Owner authority|Owner access|Owner session/i}).waitFor()
        assert.deepEqual(t.downloads,[]);assert.notEqual(await t.page.getByLabel('Export result',{exact:true}).textContent(),'Audit trail export generated.')
        results.push(`audit: ${change} prevents download and success`)
      }finally{await t.close()}
    }
  }
  console.log(JSON.stringify({synthetic:true,actualTransportAndComponents:true,networkDeliberatelyIgnoresAbort:true,cases:results}))
}finally{await browser.close()}
