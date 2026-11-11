import assert from 'node:assert/strict'

export async function runMoreAcceptance(page,base='http://127.0.0.1:5184',{diagnostic=false}={}){
  page.setDefaultTimeout(5000)
  const results=[];let run=0
  const more=()=>page.getByRole('button',{name:'More',exact:true})
  const dialog=()=>page.getByRole('dialog',{name:'More',exact:true})
  const fresh=async(width=375)=>{await page.setViewportSize({width,height:900});await page.goto(`${base}/tests/fixtures/aud04-patient-more.html?run=${++run}#p/security`);await more().waitFor({state:width<960?'visible':'hidden'})}
  const record=async(name,action)=>{try{const detail=await action();results.push({name,result:'pass',...detail})}catch(e){results.push({name,result:'FAIL',error:e.message})}}
  for(const width of [375,430,768,1024,1440])await record(`modal keyboard and pointer lifecycle at ${width}px`,async()=>{
    await fresh(width>=960?768:width)
    await more().focus();await page.keyboard.press('Enter');await dialog().waitFor()
    if(width>=960)await page.setViewportSize({width,height:900})
    assert.equal(await dialog().evaluate(el=>el.contains(document.activeElement)),true,'initial focus inside More')
    assert.equal(await dialog().evaluate(el=>el.matches(':modal')),true,'native modal semantics and background inertness')
    for(const name of ['Billing','Prescriptions','My teeth','Historical records','Documents','Profile','Sign out'])assert.equal(await dialog().getByRole('button',{name,exact:true}).count(),1,'existing shortcut retained: '+name)
    assert.equal(await page.evaluate(()=>{document.getElementById('outside-control').focus();return document.activeElement.id==='outside-control'}),false,'background cannot receive focus')
    let browserChromeStops=0
    for(const key of ['Tab','Shift+Tab'])for(let i=0;i<18;i++){
      await page.keyboard.press(key)
      const state=await dialog().evaluate(el=>({inside:el.contains(document.activeElement),tag:document.activeElement.tagName}))
      // Native dialogs may offer browser chrome a Tab stop; obscured page
      // controls must remain inert. BODY is not an application control.
      if(!state.inside&&state.tag==='BODY')browserChromeStops++
      else assert.equal(state.inside,true,'no background application Tab stops')
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    await page.keyboard.press('Escape');assert.equal(await dialog().count(),0)
    if(width<960)assert.equal(await more().evaluate(el=>el===document.activeElement),true,'restore More trigger')
    if(width>=960){assert.equal(await more().isVisible(),false);assert.equal(await page.getByRole('button',{name:'Book a visit',exact:true}).isVisible(),true,'desktop sidebar remains available');await page.setViewportSize({width:768,height:900})}
    await more().click();await dialog().waitFor()
    await dialog().getByRole('button',{name:'Close More',exact:true}).click()
    assert.equal(await more().evaluate(el=>el===document.activeElement),true)
    return {browserChromeStops,pageOverflow:false}
  })
  await record('repeated opening, backdrop dismissal and pointer navigation',async()=>{
    await fresh()
    for(let i=0;i<3;i++){await more().click();await dialog().waitFor();await page.keyboard.press('Escape');assert.equal(await dialog().count(),0)}
    await more().click();await dialog().waitFor();await page.mouse.click(8,8);assert.equal(await dialog().count(),0)
    await more().click();await dialog().getByRole('button',{name:'Billing',exact:true}).click()
    await page.waitForFunction(()=>location.hash==='#p/billing');assert.equal(await dialog().count(),0)
    await page.locator('#pp-main').waitFor();assert.equal(await page.locator('#pp-main').evaluate(el=>el===document.activeElement),true,'navigation focuses main')
  })
  await record('Sign out preserves confirmation and Cancel recovery',async()=>{
    await fresh();await more().click();await dialog().getByRole('button',{name:'Sign out',exact:true}).click()
    const confirm=page.getByRole('dialog',{name:'Sign out?',exact:true});await confirm.waitFor()
    assert.equal(await page.evaluate(()=>window.moreFixture.logout),0)
    await confirm.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await confirm.count(),0)
    await more().click();await dialog().getByRole('button',{name:'Sign out',exact:true}).click()
    await confirm.getByRole('button',{name:'Sign out',exact:true}).click()
    assert.equal(await page.evaluate(()=>window.moreFixture.logout),1)
  })
  await record('unmount closes native dialog and restores body scrolling',async()=>{
    await fresh();const overflow=await page.evaluate(()=>document.body.style.overflow)
    await more().click();await dialog().waitFor();await page.evaluate(()=>window.moreFixture.mount(false))
    assert.equal(await page.getByRole('dialog').count(),0)
    assert.equal(await page.evaluate(()=>document.body.style.overflow),overflow)
    await page.getByRole('button',{name:'Synthetic background control',exact:true}).focus()
    assert.equal(await page.getByRole('button',{name:'Synthetic background control',exact:true}).evaluate(el=>el===document.activeElement),true)
    await page.evaluate(()=>window.moreFixture.mount(true));await more().click();await dialog().waitFor();await page.keyboard.press('Escape')
    assert.equal(await page.evaluate(()=>window.moreFixture.writes.length),0)
  })
  if(!diagnostic)assert.equal(results.filter(r=>r.result==='FAIL').length,0,JSON.stringify(results))
  return results
}
