// Windows host adapter: unchanged Clinical browser assertions against the NEW Docker integration target.
import assert from 'node:assert/strict'
import {execFileSync,spawnSync} from 'node:child_process'
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {tmpdir} from 'node:os'
import {pathToFileURL} from 'node:url'
const container='dentalops-integration-20261117',manifest='/private/integration/target.json'
const run=(...args)=>execFileSync('docker',['exec',container,...args],{encoding:'utf8'})
const status=JSON.parse(run('python3','scripts/local-system.py','--target',manifest,'--profile','demo','status'))
assert.equal(status.classification,'owned isolated development');assert.equal(status.appliedMigrations,87);assert.equal(status.held.length,4)
const actual=JSON.parse(run('cat',manifest));assert.equal(actual.root,'/workspace');assert.equal(actual.runtime,'/private/integration');assert.equal(actual.reviewed_proposal,undefined)
const lane=process.argv[2]||'visit'
const files={visit:'local-visit.browser.mjs',prescription:'local-prescription.browser.mjs',operations:'integration-operations.browser.mjs',workforce:'staff-roster-publication.browser.mjs',receipts:'local-receipt-navigation.browser.mjs',history:'local-clinical-history.browser.mjs'}
assert(files[lane],'Choose a listed integration acceptance lane; no arbitrary script execution')
const root=resolve(process.env.INTEGRATION_BROWSER_EVIDENCE||join(tmpdir(),'dentalops-integration-browser-20261117'))
mkdirSync(root,{recursive:true,mode:0o700});const evidence=join(root,lane);mkdirSync(evidence,{recursive:true,mode:0o700})
writeFileSync(join(root,'visit-fixture.json'),run('cat','/private/integration/visit-fixture.json'),{mode:0o600})
if(['receipts','history'].includes(lane)){
 const observed=JSON.parse(readFileSync(join(root,'visit','journey.json'),'utf8'));assert.equal(observed.accepted,true);assert.equal(observed.invoice.status,'Paid');
 mkdirSync(join(root,'encounter-browser-batch03'),{recursive:true,mode:0o700});writeFileSync(join(root,'encounter-browser-batch03','journey.json'),JSON.stringify({scheduled:observed.treatment}),{mode:0o600});
 writeFileSync(join(root,'receipt-fixture.json'),run('cat','/private/integration/receipt-fixture.json'),{mode:0o600});
 if(lane==='receipts'){
  const statePath=join(evidence,'journey.json');
  try{readFileSync(statePath)}catch{writeFileSync(statePath,JSON.stringify({groups:[],scheduled:observed.invoice}),{mode:0o600})}
 }else{
  const receipts=JSON.parse(readFileSync(join(root,'receipts','journey.json'),'utf8'));assert.equal(receipts.accepted,true);
  mkdirSync(join(root,'receipt-browser-batch05'),{recursive:true,mode:0o700});writeFileSync(join(root,'receipt-browser-batch05','journey.json'),JSON.stringify(receipts),{mode:0o600});
 }
}
const module=process.env.PLAYWRIGHT_MODULE;assert(module,'Provide the installed Playwright index.mjs')
const helper=join(root,'support.mjs')
writeFileSync(helper,`
import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
const {chromium}=await import(${JSON.stringify(pathToFileURL(module).href)});
const password=execFileSync('docker',['exec',${JSON.stringify(container)},'cat','/private/integration/demo-login-password'],{encoding:'utf8'}).trim();
export const target=${JSON.stringify({...actual,executionRoot:actual.root,executionRuntime:actual.runtime,root:process.cwd(),runtime:root})};
export const evidence=${JSON.stringify(evidence)},base='http://127.0.0.1:5198',api='http://127.0.0.1:8124';
export const testPassword=()=>password;
export const browser=await chromium.launch({headless:true,channel:'chrome'});
export async function login(email,width=1440){const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();page.setDefaultTimeout(25000);await page.route('**/*',r=>[base,api].includes(new URL(r.request().url()).origin)?r.continue():r.abort());await page.goto(base+'/#sign-in');await page.getByRole('textbox',{name:/email/i}).fill(email);await page.locator('input[type=password]').fill(password);const response=page.waitForResponse(r=>r.url()===api+'/api/login'&&r.request().method()==='POST');await page.getByRole('button',{name:'Sign in',exact:true}).click();assert.equal((await response).status(),200);if(email.includes('patient'))await page.locator('.pp-shell').waitFor();else await page.getByRole('button',{name:'Sign out',exact:true}).waitFor();return {page,context}}
export async function get(page,path){return page.evaluate(async({api,path})=>{const r=await fetch(api+path,{credentials:'include',headers:{Accept:'application/json'}});return {status:r.status,body:await r.json()}},{api,path})}
`,{mode:0o600})
let source=readFileSync(resolve('tests',files[lane]),'utf8').replace("readFileSync(target.runtime+'/demo-login-password','utf8').trim()","(await import("+JSON.stringify(pathToFileURL(helper).href)+")).testPassword()").replaceAll("'./local-visit-support.mjs'",JSON.stringify(pathToFileURL(helper).href))
if(lane==='workforce')source=source.replaceAll('dentalops-joevan-ops-20261115',container).replaceAll('/private/roster11b','/private/integration').replaceAll('http://127.0.0.1:5195','http://127.0.0.1:5198').replaceAll('http://127.0.0.1:8104','http://127.0.0.1:8124');
const script=join(root,lane+'.mjs');writeFileSync(script,source,{mode:0o600})
const log=join(evidence,'browser.log');const result=spawnSync(process.execPath,[script,module],{env:{...process.env,LOCAL_SYSTEM_EVIDENCE:evidence,LOCAL_VISIT_DROP_PAYMENT_RESPONSE:'1'},encoding:'utf8',timeout:240000,maxBuffer:8*1024*1024})
writeFileSync(log,(result.stdout||'')+(result.stderr||''),{mode:0o600})
const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
writeFileSync(join(evidence,'run.json'),JSON.stringify({candidate:sha,lane,status:result.status,source:files[lane],adapter:'Host origins and private artifact paths only; original assertion source unchanged',api:'http://127.0.0.1:8124',ui:'http://127.0.0.1:5198',executionTarget:{host:actual.host,port:actual.port,runtime:actual.runtime},error:result.error?.code||null},null,2),{mode:0o600})
console.log('Integration browser',lane,'exit',result.status,'evidence',evidence)
for(const line of (result.stdout||'').split('\n').filter(s=>s.startsWith('PASS ')))console.log(line)
if(result.status!==0)console.log((result.stderr||'').slice(-1400))
process.exitCode=result.status??1
