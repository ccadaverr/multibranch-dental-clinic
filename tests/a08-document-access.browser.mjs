// Verify the existing J02 document path only; no unpublished Clinical source or new document contract.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
const {browser,login,get,base,api,evidence}=await import('./local-visit-support.mjs')
const file=evidence+'/document.json',state=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{}
let page
try{
 const own=await login('patient@example.test');page=own.page
 if(!state.id){
  const bytes=[...readFileSync(process.env.A08_RECEIPT_PDF)]
  const result=await page.evaluate(async bytes=>{
   const form=new FormData();form.set('file',new File([new Uint8Array(bytes)],'synthetic-a08.pdf',{type:'application/pdf'}))
   form.set('category','other');form.set('title','Synthetic A08 protected access check');form.set('other_description','Synthetic acceptance document, not clinic data')
   return (await import('/src/api-client.js')).uploadDocument(form,'a08-synthetic-document')
  },bytes)
  assert.equal(result.ok,true);state.id=result.data.id;writeFileSync(file,JSON.stringify(state,null,2))
 }
 const metadata=await get(page,'/api/documents/'+state.id);assert.equal(metadata.status,200)
 await page.getByRole('button',{name:'Documents',exact:true}).first().click();await page.getByText('Synthetic A08 protected access check',{exact:true}).waitFor()
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download',exact:true}).click()
 const pdf=await download;await pdf.saveAs(evidence+'/document.pdf');assert.deepEqual(readFileSync(evidence+'/document.pdf'),readFileSync(process.env.A08_RECEIPT_PDF))
 const foreign=await login('sprint02.patient@example.test')
 assert.equal((await get(foreign.page,'/api/documents/'+state.id)).status,403)
 assert.equal((await get(foreign.page,'/api/documents/'+state.id+'/download')).status,403)
 console.log('PASS existing J02 Patient document library, exact protected download bytes and foreign Patient metadata/file denial; no new document API/CORS implementation')
}catch(error){if(page)writeFileSync(evidence+'/failure-text.txt',await page.locator('body').innerText());throw error}
finally{await browser.close()}
