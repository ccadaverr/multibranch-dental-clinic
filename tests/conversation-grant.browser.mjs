// Real React/API client, synthetic HTTP responses only. PostgreSQL lifecycle is tested separately in the reviewed grant lab.
import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
const {browser,base,api,evidence}=await import('./local-visit-support.mjs')
const page=await browser.newPage({viewport:{width:1440,height:1000}}),calls=[];let unavailable=false
const cid='01ARZ3NDEKTSV4RRFFQ69G5FAV',did='01ARZ3NDEKTSV4RRFFQ69G5FAW',gid='01ARZ3NDEKTSV4RRFFQ69G5FAX'
await page.route('**/*',async route=>{
 const request=route.request(),url=new URL(request.url())
 if(url.origin===base)return route.continue()
 if(url.origin!==api)return route.abort()
 if(url.pathname==='/sanctum/csrf-cookie')return route.fulfill({status:204,headers:{'access-control-allow-origin':base,'access-control-allow-credentials':'true'}})
 const headers={'access-control-allow-origin':base,'access-control-allow-credentials':'true','access-control-allow-headers':'*','content-type':'application/json'}
 if(request.method()==='OPTIONS')return route.fulfill({status:204,headers})
 if(unavailable&&request.method()==='GET')return route.fulfill({status:409,headers,body:JSON.stringify({code:'conversation_grants_unavailable',message:'Dentist reassignment is unavailable. No access was changed. Contact the clinic administrator.'})})
 if(request.method()==='GET')return route.fulfill({status:200,headers,body:JSON.stringify({data:[{id:did,name:'Synthetic Dentist with a long readable name',participant:false}],meta:{grant_required:true,revision:7,context:{conversation_id:cid,patient_id:'01ARZ3NDEKTSV4RRFFQ69G5FAY',branch_id:'b1'}}})})
 calls.push({url:url.pathname,body:request.postDataJSON(),key:request.headers()['idempotency-key']})
 if(calls.length===1)return route.abort('failed')
 return route.fulfill({status:201,headers,body:JSON.stringify({data:{id:cid,grant_id:gid,dentist_id:did,patient_id:'01ARZ3NDEKTSV4RRFFQ69G5FAY',branch_id:'b1',revision:8,changed:true}})})
})
try{
 await page.goto(base+'/tests/fixtures/conversation-grant.html',{timeout:60000})
 await page.getByRole('button',{name:'Switch dentist',exact:true}).click()
 const choice=page.getByRole('combobox',{name:'Dentist to switch to'}),reason=page.getByRole('textbox',{name:'Reason for reassignment'})
 await choice.selectOption(did);assert(await page.getByRole('button',{name:'Switch',exact:true}).isDisabled())
 await reason.fill('Synthetic Staff-approved reassignment')
 const change=page.getByRole('button',{name:'Switch',exact:true});await change.focus();await page.keyboard.press('Enter')
 await page.getByRole('status').filter({hasText:'outcome is unverified'}).waitFor()
 assert(await choice.isDisabled());assert(await reason.isDisabled());assert(await page.getByRole('button',{name:'Cancel',exact:true}).isDisabled())
 for(const width of [375,390,430,768,1024,1440]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'uncertain overflow '+width);await page.screenshot({path:evidence+'/conversation-grant-uncertain-'+width+'.png',fullPage:true})}
 const retry=page.getByRole('button',{name:'Retry reassignment',exact:true});await retry.focus();await page.keyboard.press('Enter')
 await page.getByRole('status').filter({hasText:'Confirmed changes: 1'}).waitFor()
 assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);assert(calls[0].key);assert.equal(calls[0].body.expected_revision,7);assert.equal(calls[0].body.dentist_id,did)
 for(const width of [375,390,430,768,1024,1440]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'recovered overflow '+width);await page.screenshot({path:evidence+'/conversation-grant-recovered-'+width+'.png',fullPage:true})}
 unavailable=true;await page.getByRole('button',{name:'Switch dentist',exact:true}).click()
 await page.getByRole('alert').filter({hasText:'Dentist reassignment is unavailable. No access was changed.'}).waitFor()
 assert(await page.getByRole('button',{name:'Switch',exact:true}).isDisabled());assert.equal(calls.length,2)
 for(const width of [375,390,430,768,1024,1440]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'unavailable overflow '+width);await page.screenshot({path:evidence+'/conversation-grant-unavailable-'+width+'.png',fullPage:true})}
 const cancel=page.getByRole('button',{name:'Cancel',exact:true});await cancel.focus();await page.keyboard.press('Enter');await page.getByRole('button',{name:'Switch dentist',exact:true}).waitFor()
 writeFileSync(evidence+'/conversation-grant.json',JSON.stringify({accepted:true,scope:'Real React/API client; mocked HTTP loss and receipt, required reason, frozen original Dentist/revision/reason/key, keyboard and six widths. Not integrated browser acceptance.'},null,2))
 console.log('PASS conversation grant reason, original-key retry, unavailable-schema refusal, keyboard and six widths (synthetic HTTP)')
}finally{await browser.close()}
