import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {build} from 'esbuild'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'

const require=createRequire(import.meta.url)
const bundle=await build({stdin:{contents:"export {Shell,NotificationPanel} from './src/layout.jsx'",resolveDir:process.cwd()},bundle:true,write:false,loader:{'.css':'empty'},platform:'node',format:'esm',plugins:[{name:'shared-react',setup(b){b.onResolve({filter:/^react$/},()=>({path:pathToFileURL(require.resolve('react')).href,external:true}))}}]})
const {Shell,NotificationPanel}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)

// Fictional, isolated identities only. No API, localStorage, clinical content or real account.
function fixture(role='staff',long=false){
  const roles=['patient','staff','dentist','owner']
  const users=roles.map(r=>({id:`u-${r}`,personId:`person-${r}`,name:`Fictional ${r}${long?' with a deliberately long display name':''}`,role:r==='owner'?'Owner / Admin':r[0].toUpperCase()+r.slice(1),status:'Active',branchId:'b1',permissions:r==='patient'?['patient-portal']:['all']}))
  const state={persons:roles.map(r=>({id:`person-${r}`})),users,staff:[{userId:'u-staff',personId:'person-staff',branchId:'b1'}],dentists:[{id:'d1',userId:'u-dentist',personId:'person-dentist',branchIds:['b1']}],branches:[{id:'b1',name:long?'Fictional branch with a very long operational location name':'Fictional branch'}],patients:[{id:'p1',userId:'u-patient',personId:'person-patient',name:'Fictional Patient'}],appointments:[{id:'a1',patientId:'p1',dentistId:'d1',branchId:'b1'}],queue:[],treatments:[],invoices:[],prescriptions:[],hmo:[],conversations:[],notifications:[]}
  const session={role,userId:`u-${role}`,patientId:role==='patient'?'p1':undefined,dentistId:role==='dentist'?'d1':undefined,branchId:'b1',active:true}
  return {state,session,actions:{},toast:()=>{}}
}
const note=(id,extra={})=>({id,title:`Fictional update ${id}`,body:'Fictional reminder for acceptance only.',recipientUserId:'u-staff',branchId:'b1',patientId:'p1',read:false,createdAt:'2026-10-30T09:00:00+08:00',channel:'In-app',entityType:'appointment',entityId:'a1',action:{page:'appointments'},...extra})
const render=(C,props)=>renderToStaticMarkup(React.createElement(C,props))

test('A12 production shell preserves permission-filtered navigation and current-page context for every role',()=>{
  for(const role of ['patient','staff','dentist','owner']){
    const store=fixture(role)
    const html=render(Shell,{role,page:'dashboard',setPage:()=>{},onLogout:()=>{},activeBranch:'Fictional branch',setActiveBranch:()=>{},store,children:'Fictional workspace'})
    assert.match(html,/a12-shell/)
    assert.match(html,/workspace-page/)
    assert.match(html,/aria-current="page"/)
    assert.match(html,/Skip to content/)
    assert.match(html,/Dr\. Dana E\. Roxas/)
    assert.doesNotMatch(html,/Module Coverage/)
    const denied=render(Shell,{role,page:'modules',setPage:()=>{},onLogout:()=>{},store})
    assert.doesNotMatch(denied,/class="workspace-page"/,'forbidden page has no current-page label')
  }
  const store=fixture('staff');store.state.users.find(u=>u.id==='u-staff').permissions=[]
  const html=render(Shell,{role:'staff',page:'billing',setPage:()=>{},onLogout:()=>{},store})
  assert.doesNotMatch(html,/class="workspace-page"/)
  assert.doesNotMatch(html,/>Billing<\/span>/,'restricted Staff navigation remains filtered')
  const server=fixture('staff');server.session.serverUserId='fictional-server-user'
  assert.match(render(Shell,{role:'staff',page:'capacity',setPage:()=>{},onLogout:()=>{},store:server}),/class="workspace-page">Live Queue by Branch<\/b>/)
})

test('A12 notification rendering preserves scope, unread semantics, guarded destinations and escaping',()=>{
  const store=fixture()
  store.state.notifications=[note('own',{title:'<script>fictional</script>'}),note('read',{read:true}),note('other',{recipientUserId:'u-owner'}),note('denied',{action:{page:'users'}})]
  const html=render(NotificationPanel,{role:'staff',store,onClose:()=>{},setPage:()=>{}})
  assert.match(html,/2 unread/)
  assert.doesNotMatch(html,/Showing 3 of 3/)
  assert.match(html,/role="region" aria-label="Notification history" tabindex="0" aria-busy="false"/)
  assert.equal((html.match(/notification-unread-label/g)||[]).length,2)
  assert.equal((html.match(/>View update<\/button>/g)||[]).length,2)
  assert.match(html,/&lt;script&gt;fictional&lt;\/script&gt;/)
  assert.doesNotMatch(html,/>Fictional update other</)
  assert.doesNotMatch(html,/>View all \(3\)/)
})

test('A12 empty notification state describes this workspace without claiming server synchronization',()=>{
  const html=render(NotificationPanel,{role:'staff',store:fixture(),onClose:()=>{},setPage:()=>{}})
  assert.match(html,/No unread updates/)
  assert.match(html,/No updates to show in this workspace/)
  assert.doesNotMatch(html,/Loading|synchronized|server is up to date/i)
})

const fixtureHtml=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>A12 fictional shell acceptance</title><script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;
window.__vite_plugin_react_preamble_installed__=true;
</script></head><body><div id="root"></div><script type="module">
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import {Shell} from '/src/layout.jsx';
import {communicationActions} from '/src/communication.js';
import {setClockSource,clinicNow} from '/src/clock.js';
import '/src/styles.css';import '/src/foundation.css';import '/src/patient.css';import '/src/polish.css';
setClockSource(()=>new Date('2026-10-30T10:00:00+08:00'));
const params=new URLSearchParams(location.search),role=params.get('role')||'staff';
const initial=(${fixture.toString()})(role,params.has('long'));
function Fixture(){
 const [state,setState]=React.useState(initial.state),[page,setPage]=React.useState('dashboard'),[branch,setBranch]=React.useState(role==='owner'?'All Branches':initial.state.branches[0].name),[feedback,setFeedback]=React.useState('');
 const session=initial.session;
 window.a12State=state;
 window.configure=(items,mode='')=>{window.mode=mode;window.calls=0;setFeedback('');setState(s=>({...s,notifications:items}));};
 const actions=communicationActions(command=>(...args)=>{
   window.calls=(window.calls||0)+1;
   if(window.mode==='pending')return new Promise(resolve=>{window.finish=resolve});
   if(window.mode==='throw')throw Error('Fictional failure');
   if(window.mode==='reject')return Promise.reject(Error('Fictional rejection'));
   if(window.mode==='failure')return {ok:false,message:'Fictional read refusal. Try the same action again.'};
   const next=structuredClone(state),result=command({state:next,session,now:clinicNow()},...args);
   if(result.ok)setState(next);return result;
 });
 return React.createElement(Shell,{role,page,setPage,onLogout:()=>{window.signedOut=true},activeBranch:branch,setActiveBranch:setBranch,store:{state,session,actions,toast:setFeedback}},
   React.createElement('h1',null,'Fictional workspace'),React.createElement('p',null,'Production shell with fictional fixtures. No real Patient records.'),React.createElement('output',{id:'feedback'},feedback));
}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Fixture));
</script></body></html>`

// Optional real-browser gate. Uses an already installed Playwright; never installs dependencies.
// Start Vite on 5178 first. See docs/A12_SHELL_UI_ACCEPTANCE.md for exact commands.
test('A12 real production shell: responsive roles, keyboard, scrolling, pending/failure and logout', {skip:!process.env.A12_PLAYWRIGHT_MODULE,timeout:180000},async()=>{
  const {chromium}=await import(pathToFileURL(process.env.A12_PLAYWRIGHT_MODULE).href)
  const browser=await chromium.launch({headless:true,channel:'chrome'})
  const servedShell=await (await fetch('http://127.0.0.1:5178/src/layout.jsx')).text()
  const reactUrl=servedShell.match(/"(\/node_modules\/\.vite\/deps\/react\.js\?v=[^"]+)"/)?.[1]
  assert.ok(reactUrl,'use the dev server’s exact React module to avoid duplicate hook runtimes')
  const html=fixtureHtml.replace('/node_modules/.vite/deps/react.js',reactUrl)
  const screenshotDir=process.env.A12_SCREENSHOTS
  if(screenshotDir)await mkdir(screenshotDir,{recursive:true})
  try {
    for(const width of [1440,390,375,430,768,1024])for(const role of ['staff','dentist','owner','patient']){
      const height=width<=430?844:900
      const page=await browser.newPage({viewport:{width,height}}),errors=[]
      page.on('pageerror',e=>errors.push(e.message))
      await page.route('**/api/**',r=>r.abort())
      await page.route('**/a12-shell-fixture?*',r=>r.fulfill({contentType:'text/html',body:html}))
      await page.goto(`http://127.0.0.1:5178/a12-shell-fixture?role=${role}&long=1`)
      const bell=page.getByRole('button',{name:/^Notifications/})
      await bell.waitFor({timeout:10000}).catch(error=>{throw new Error(`${error.message}; page errors: ${errors.join('; ')}`)})
      assert.ok(await page.locator('.workspace-page').innerText())
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${role} ${width} horizontal overflow`)
      await page.keyboard.press('Tab')
      assert.equal(await page.locator('.skip-link').evaluate(e=>document.activeElement===e),true)
      await page.keyboard.press('Enter')
      assert.equal(await page.locator('main').evaluate(e=>document.activeElement===e),true)
      if(width<=1024){
        const opener=role==='patient'?page.getByRole('button',{name:'Menu',exact:true}):page.getByRole('button',{name:'Open navigation'})
        await opener.click()
        const menu=page.getByRole('dialog')
        await menu.waitFor()
        assert.ok(await menu.getByRole('button',{name:'Sign out',exact:true}).isVisible())
        await page.keyboard.press('Escape')
        assert.equal(await opener.evaluate(e=>document.activeElement===e),true)
        if(role==='patient')assert.deepEqual(await page.locator('.patient-mobile-nav button').allTextContents(),['Home','Book','Visits','Menu'])
        await opener.click()
        const target=role==='patient'?menu.getByRole('button',{name:'Book Appointment',exact:true}):menu.locator('.main-nav button').nth(1)
        const label=(await target.innerText()).trim()
        await target.focus();await page.keyboard.press('Enter')
        await menu.waitFor({state:'hidden'})
        assert.equal((await page.locator('.workspace-page').innerText()).trim(),label)
      }else{
        const target=page.locator('.sidebar .main-nav button').nth(1),label=(await target.innerText()).trim()
        await target.focus();await page.keyboard.press('Enter')
        assert.equal(await target.getAttribute('aria-current'),'page')
        assert.equal((await page.locator('.workspace-page').innerText()).trim(),label)
      }
      if(role==='owner'){
        const select=page.locator('.topbar select')
        await select.selectOption({index:1});assert.equal(await select.inputValue(),'Fictional branch with a very long operational location name')
      }else assert.equal(await page.locator('.topbar select').count(),0)
      if(screenshotDir&&[1440,390].includes(width))await page.screenshot({path:join(screenshotDir,`shell-${role}-${width}.png`),fullPage:true})
      await bell.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab')
      assert.notEqual(await bell.evaluate(e=>getComputedStyle(e).outlineStyle),'none')
      await page.keyboard.press('Enter')
      const dialog=page.getByRole('dialog',{name:'Notifications',exact:true})
      await dialog.getByText("You're all caught up.",{exact:true}).waitFor()
      await page.keyboard.press('Escape');assert.equal(await bell.evaluate(e=>document.activeElement===e),true)
      const notifications=Array.from({length:20},(_,i)=>note(String(i),{recipientUserId:`u-${role}`,dentistId:'d1',body:i===19?'LongFictionalBody'.repeat(80):'Fictional reminder. No clinical content.'}))
      await page.evaluate(items=>window.configure(items),notifications)
      await bell.click();await dialog.getByRole('button',{name:/View all/}).click()
      assert.equal(await dialog.locator('.notification-row').count(),20)
      assert.equal(await dialog.locator('.notification-unread-label').count(),20)
      const history=dialog.getByRole('region',{name:'Notification history'})
      await dialog.getByRole('button',{name:'Recent only',exact:true}).focus();await page.keyboard.press('Tab')
      assert.equal(await history.evaluate(e=>document.activeElement===e),true)
      assert.notEqual(await history.evaluate(e=>getComputedStyle(e).outlineStyle),'none')
      await page.keyboard.press('End')
      await page.waitForFunction(()=>{const e=document.querySelector('.notification-scroll');return e.scrollTop>0})
      assert.ok(await history.evaluate(e=>e.scrollHeight>e.clientHeight&&e.scrollWidth<=e.clientWidth+1))
      const box=await dialog.boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=height+1)
      for(let i=0;i<12;i++){await page.keyboard.press('Tab');assert.ok(await dialog.evaluate(e=>e.contains(document.activeElement)),'focus remains in dialog')}
      await history.evaluate(e=>{e.focus({preventScroll:true});e.scrollTo({top:0,behavior:'instant'})})
      if(screenshotDir&&[1440,390].includes(width))await page.screenshot({path:join(screenshotDir,`notifications-${role}-${width}.png`),fullPage:true})
      await dialog.getByRole('button',{name:'Mark my notifications read'}).click()
      await page.waitForFunction(()=>window.a12State.notifications.every(n=>n.read))
      await dialog.getByRole('button',{name:'Close Notifications',exact:true}).click()
      for(const mode of ['failure','throw','reject','pending']){
        await page.evaluate(({items,mode})=>window.configure(items,mode),{items:[notifications[0]],mode})
        await bell.click()
        await dialog.getByRole('button',{name:'Mark read',exact:true}).click()
        if(mode==='pending'){
          await dialog.getByText('Updating read status…',{exact:true}).waitFor()
          assert.equal(await history.getAttribute('aria-busy'),'true')
          assert.equal(await dialog.getByRole('button',{name:'Mark my notifications read'}).isDisabled(),true)
          assert.equal(await page.evaluate(()=>window.calls),1)
          await page.evaluate(()=>window.finish({ok:false,message:'Fictional delayed refusal.'}))
        }
        await dialog.getByRole('alert').waitFor()
        assert.equal(await page.evaluate(()=>window.a12State.notifications[0].read),false)
        if(screenshotDir&&width===390&&role==='staff'&&mode==='failure')await page.screenshot({path:join(screenshotDir,'notification-failure-390.png'),fullPage:true})
        await page.evaluate(()=>{window.mode=''})
        await dialog.getByRole('button',{name:'Mark read',exact:true}).click()
        await page.waitForFunction(()=>window.a12State.notifications[0].read)
        assert.equal(await dialog.getByRole('alert').count(),0)
        await page.keyboard.press('Escape')
      }
      await page.emulateMedia({reducedMotion:'reduce'})
      assert.equal(await bell.evaluate(e=>getComputedStyle(e).transitionDuration),'0s')
      if(width<=1024)await page.getByRole('button',{name:role==='patient'?'Menu':'Open navigation',exact:true}).click()
      const signOut=width>1024?page.locator('.sidebar').getByRole('button',{name:'Sign out',exact:true}):page.getByRole('dialog').getByRole('button',{name:'Sign out',exact:true})
      await signOut.click()
      const confirm=page.getByRole('dialog',{name:'Sign out?',exact:true})
      await confirm.waitFor();assert.equal(await confirm.getByRole('button',{name:'Cancel',exact:true}).evaluate(e=>document.activeElement===e),true)
      await confirm.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.evaluate(()=>!!window.signedOut),false)
      assert.deepEqual(errors,[])
      console.log(`A12 browser PASS ${role} ${width}: context, overflow, keyboard, dialog, scroll, read, failure/retry, pending, reduced motion, logout cancellation`)
      await page.close()
    }
  }finally{await browser.close()}
})
