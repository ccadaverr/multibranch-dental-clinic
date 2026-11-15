import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFileSync,mkdirSync,statSync} from 'node:fs'
import {resolve} from 'node:path'
export const target=JSON.parse(readFileSync(process.env.DENTALOPS_LOCAL_TARGET,'utf8'))
assert.equal(target.root,process.cwd());assert.equal(target.host,'127.0.0.1')
export const evidence=process.env.LOCAL_SYSTEM_EVIDENCE || resolve(target.runtime,'visit-evidence')
export const base='http://127.0.0.1:5195',api='http://127.0.0.1:8104'
const password=readFileSync(resolve(target.runtime,'demo-login-password'),'utf8').trim()
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
mkdirSync(evidence,{recursive:true,mode:0o700})
assert.equal(statSync(process.env.DENTALOPS_LOCAL_TARGET).mode & 0o077,0)
export const browser=await chromium.launch({headless:true,channel:'chrome'})
export async function login(email,width=1440){const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();page.setDefaultTimeout(18000);await page.route('**/*',r=>[base,api].includes(new URL(r.request().url()).origin)?r.continue():r.abort());await page.goto(base+'/#sign-in');await page.getByRole('textbox',{name:/email/i}).fill(email);await page.locator('input[type=password]').fill(password);const response=page.waitForResponse(r=>r.url()===api+'/api/login'&&r.request().method()==='POST');await page.getByRole('button',{name:'Sign in',exact:true}).click();assert.equal((await response).status(),200);if(email.includes('patient')) await page.locator('.pp-shell').waitFor(); else await page.getByRole('button',{name:'Sign out',exact:true}).waitFor({state:'visible'});return {page,context}}
export async function get(page,path){return page.evaluate(async({api,path})=>{const r=await fetch(api+path,{credentials:'include',headers:{Accept:'application/json'}});return {status:r.status,body:await r.json()}},{api,path})}
