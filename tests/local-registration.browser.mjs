// Real account -> local SMTP capture -> verification -> voluntary sign-in. No OTP or password is logged.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {randomBytes} from 'node:crypto'
import {readFileSync,readdirSync,statSync,writeFileSync,mkdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {userInfo} from 'node:os'
const manifest=process.env.DENTALOPS_LOCAL_TARGET
assert.ok(manifest);assert.equal(statSync(manifest).uid,userInfo().uid);assert.equal(statSync(manifest).mode&0o077,0)
const target=JSON.parse(readFileSync(manifest,'utf8'));assert.equal(target.root,process.cwd());assert.equal(target.host,'127.0.0.1')
const api='http://127.0.0.1:8104',base='http://127.0.0.1:5195'
const email='local_'+Date.now()+'@example.test',password='Aa1!'+readFileSync(resolve(target.runtime,'demo-login-password'),'utf8').trim()
const family='Registration'+[...randomBytes(8)].map(n=>String.fromCharCode(65+n%26)).join('')
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright')
const browser=await chromium.launch({headless:true,channel:'chrome'}),page=await browser.newPage({viewport:{width:390,height:1000}}),errors=[]
const secretFill=async(locator,value)=>{await locator.waitFor({state:'visible'});await locator.evaluate((el,secret)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,secret);el.dispatchEvent(new Event('input',{bubbles:true}))},value)}
page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000)
try{
 await page.route('**/*',r=>[api,base].includes(new URL(r.request().url()).origin)?r.continue():r.abort())
 await page.goto(base+'/#create-account')
 await page.getByRole('textbox',{name:/^First name/}).fill('Synthetic')
 await page.getByRole('textbox',{name:/^Last name/}).fill(family)
 await page.getByLabel(/^Date of birth/).fill('1995-04-12')
 await page.getByRole('textbox',{name:/^Email/}).fill(email)
 await page.getByRole('textbox',{name:/^Phone number/}).fill('917'+String(Math.floor(Math.random()*10000000)).padStart(7,'0'))
 await secretFill(page.getByLabel(/^Password/),password)
 await secretFill(page.getByLabel(/^Confirm password/),password)
 await page.getByRole('checkbox',{name:/I agree/}).check()
 const registered=page.waitForResponse(r=>r.url()===api+'/api/register'&&r.request().method()==='POST')
 await page.getByRole('button',{name:'Create account',exact:true}).click();assert.equal((await registered).status(),201)
 const codeField=page.getByRole('textbox',{name:'Email verification code',exact:true});await codeField.waitFor()
 let otp='',messageFile='';const deadline=Date.now()+12000
 while(!otp&&Date.now()<deadline){
  for(const name of readdirSync(resolve(target.runtime,'mailbox')).filter(n=>n.endsWith('.eml'))){
   const raw=readFileSync(resolve(target.runtime,'mailbox',name),'utf8');if(!raw.includes(email))continue
   const part=raw.match(/Content-Type: text\/plain[^]*?\r?\n\r?\n([^]*?)(?:\r?\n--|$)/i)?.[1]||''
   const decoded=part.replace(/=\r?\n/g,'').replace(/=([A-Fa-f0-9]{2})/g,(_,hex)=>String.fromCharCode(parseInt(hex,16)))
   otp=decoded.match(/Your verification code:\s*(\d{6})/)?.[1]||'';if(otp){messageFile=name;break}
  }
  if(!otp)await new Promise(r=>setTimeout(r,100))
 }
 assert.equal(otp.length,6,'A real code must arrive through local SMTP capture')
 await secretFill(codeField,otp);await page.getByRole('button',{name:'Verify email',exact:true}).click()
 await page.getByRole('heading',{name:'Welcome back',exact:true}).waitFor()
 const anonymous=await page.evaluate(async api=>(await fetch(api+'/api/me',{credentials:'include',headers:{Accept:'application/json'}})).status,api)
 assert.equal(anonymous,401,'Verification must not automatically authenticate the account')
 assert.equal(await page.getByRole('textbox',{name:/email/i}).inputValue(),email)
 await secretFill(page.locator('input[type=password]'),password)
 const signedIn=page.waitForResponse(r=>r.url()===api+'/api/login'&&r.request().method()==='POST');await page.getByRole('button',{name:'Sign in',exact:true}).click();assert.equal((await signedIn).status(),200)
 await page.reload();const self=await page.evaluate(async api=>{const r=await fetch(api+'/api/me',{credentials:'include',headers:{Accept:'application/json'}});return {status:r.status,body:await r.json()}},api)
 assert.equal(self.status,200);assert.equal(self.body.data.role,'patient');assert.ok(self.body.data.patient.id)
 assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
 const evidence=process.env.LOCAL_SYSTEM_EVIDENCE||resolve(target.runtime,'browser-evidence');mkdirSync(evidence,{recursive:true})
 writeFileSync(resolve(evidence,'registration-result.json'),JSON.stringify({passed:true,realSmtp:true,externalDelivery:false,verificationRequiresVoluntaryLogin:true,persistedPatientId:self.body.data.patient.id,privateMailboxFile:messageFile},null,2))
 console.log('PASS real registration, local SMTP verification, no auto-login, voluntary sign-in and persisted patient identity')
}finally{await browser.close()}
