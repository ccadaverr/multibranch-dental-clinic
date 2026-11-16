import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
const {chromium}=await import(pathToFileURL(process.argv[2]).href)
const base=process.argv[3]||'http://127.0.0.1:5195'
const browser=await chromium.launch({channel:'chrome',headless:true})
const rows=[
 {id:'global',date:'2026-12-01',status:'active',branch:null,reason:'Synthetic global closure'},
 {id:'north',date:'2026-12-02',status:'active',branch:{id:'b1',name:'Synthetic B1'},reason:'Synthetic north closure'},
 {id:'south',date:'2026-12-03',status:'active',branch:{id:'b2',name:'Synthetic B2'},reason:'Synthetic south closure'},
]
try{
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:1000}}),writes=[],errors=[]
  page.setDefaultTimeout(7000);page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort())
  await page.route('**/api/**',route=>{
   if(route.request().method()!=='GET'){writes.push(route.request().method());return route.abort()}
   return route.fulfill({json:{data:new URL(route.request().url()).pathname==='/api/branch-closures'?rows:[],meta:{}}})
  })
  await page.goto(base+'/tests/fixtures/closed-date-filter.html')
  const branch=page.getByRole('combobox',{name:'Filter closures by branch',exact:true}),search=page.getByRole('searchbox')
  await page.getByRole('listitem').filter({hasText:'Synthetic global closure'}).waitFor()
  await branch.selectOption({label:'Synthetic B1'})
  assert.equal(await page.getByRole('listitem').filter({hasText:'Synthetic global closure'}).count(),1,'An all-branch closure must remain applicable to a selected branch')
  assert.equal(await page.getByRole('listitem').count(),2)
  await search.fill('north')
  assert.equal(await page.getByRole('listitem').count(),1)
  await page.getByRole('button',{name:'Clear filters',exact:true}).focus();await page.keyboard.press('Enter')
  assert.equal(await search.inputValue(),'');assert.equal(await branch.inputValue(),'All')
  assert.equal(await page.getByRole('listitem').count(),3)
  await branch.selectOption({label:'Synthetic B1'})
  await page.evaluate(()=>window.closureFixture.rename())
  await branch.locator('option').getByText('Renamed B1',{exact:true}).waitFor({state:'attached'})
  assert.equal(await branch.inputValue(),'b1')
  assert.equal(await page.getByRole('listitem').count(),2)
  await search.fill('no matching closure')
  await page.getByText('No closures matching your filters.',{exact:true}).waitFor()
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[])
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  await page.close();process.stdout.write(`Closed-date applicability/search/reset/identity passed at ${width}px\n`)
 }
}finally{await browser.close()}
