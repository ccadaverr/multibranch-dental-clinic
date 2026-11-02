import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {transform} from 'esbuild'
import {chromium} from 'playwright'
const browser=await chromium.launch({channel:'chrome',headless:true})
const page=await browser.newPage();page.setDefaultTimeout(3000)
page.on('pageerror',e=>console.error(e.message))
const reads=[]
if(process.env.QA_BASELINE_CALENDAR==='1'){
 const source=execFileSync('git',['show','HEAD:src/patient/BookingCalendar.jsx'],{encoding:'utf8'})
 const {code}=await transform(source,{loader:'jsx',format:'esm'})
 const baseline=code.replace(/import React, \{[^}]+\} from "react";/,'import React from "/node_modules/.vite/deps/react.js"; const {useEffect,useMemo,useState}=React;')
 await page.route('**/src/patient/BookingCalendar.jsx*',r=>r.fulfill({contentType:'text/javascript',body:baseline}))
}
await page.route('**/api/**',r=>{
 const u=new URL(r.request().url()),branch=u.searchParams.get('branch_ref')
 if(u.pathname.endsWith('/calendar')){reads.push(branch);return r.fulfill({json:{data:{month:'2099-11',today:'2099-11-01',days:[{date:'2099-11-02',status:branch==='b2'?'closed':'available',reason:branch==='b2'?'Synthetic closure':null}]}}})}
 return r.fulfill({json:{data:[]}})
})
try{
 await page.goto('http://127.0.0.1:5187/tests/fixtures/yzh-qa-02.html');await page.waitForFunction(()=>window.qa02);await page.evaluate(()=>window.qa02.setMode('calendar'))
 await page.getByRole('gridcell',{name:/available/}).waitFor()
 await page.evaluate(()=>window.qa02.setBranch('b2'))
 await page.getByRole('gridcell',{name:/Synthetic closure/}).waitFor()
 assert(reads.includes('b2'));console.log('PASS same-month branch change reloads the calendar; reads='+JSON.stringify(reads))
}finally{await browser.close()}
