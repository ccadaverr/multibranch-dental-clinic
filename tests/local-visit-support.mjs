import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFileSync,mkdirSync,statSync} from 'node:fs'
import {resolve} from 'node:path'
import {execFileSync} from 'node:child_process'
const container=process.env.LOCAL_SYSTEM_CONTAINER
export const privateRead=path=>container?execFileSync('docker',['exec',container,'cat',path],{encoding:'utf8'}):readFileSync(path,'utf8')
export const target=JSON.parse(privateRead(process.env.DENTALOPS_LOCAL_TARGET))
if(container){
 assert.equal(privateRead(target.runtime+'/synthetic-runtime').trim(),target.cluster_id)
 assert.equal(target.demo_database,'dental_clinic_demo')
}else assert.equal(target.root,process.cwd())
assert.equal(target.host,'127.0.0.1')
export const evidence=process.env.LOCAL_SYSTEM_EVIDENCE || resolve(target.runtime,'visit-evidence')
export const base=process.env.LOCAL_SYSTEM_BASE||'http://127.0.0.1:5195',api=process.env.LOCAL_SYSTEM_API||'http://127.0.0.1:8104'
for(const value of [base,api]){const url=new URL(value);assert.equal(url.protocol,'http:');assert.equal(url.hostname,'127.0.0.1');assert(+url.port>=1024&&+url.port<=65535)}
const password=privateRead(target.runtime+'/demo-login-password').trim()
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
mkdirSync(evidence,{recursive:true,mode:0o700})
if(!container)assert.equal(statSync(process.env.DENTALOPS_LOCAL_TARGET).mode & 0o077,0)
export const browser=await chromium.launch({headless:true,channel:'chrome'})
export async function login(email,width=1440){const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();page.setDefaultTimeout(Number(process.env.LOCAL_SYSTEM_BROWSER_TIMEOUT_MS)||18000);await page.route('**/*',r=>[base,api].includes(new URL(r.request().url()).origin)?r.continue():r.abort());await page.goto(base+'/#sign-in');await page.getByRole('textbox',{name:/email/i}).fill(email);await page.locator('input[type=password]').fill(password);const response=page.waitForResponse(r=>r.url()===api+'/api/login'&&r.request().method()==='POST');await page.getByRole('button',{name:'Sign in',exact:true}).click();assert.equal((await response).status(),200);if(email.includes('patient')) await page.locator('.pp-shell').waitFor(); else await page.getByRole('button',{name:'Sign out',exact:true}).waitFor({state:'visible'});return {page,context}}
export async function get(page,path){return page.evaluate(async({api,path})=>{const r=await fetch(api+path,{credentials:'include',headers:{Accept:'application/json'}});return {status:r.status,body:await r.json()}},{api,path})}
