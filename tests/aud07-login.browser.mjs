import assert from 'node:assert/strict'

// Deterministic component/HTTP and real App acceptance. Transport is fixture-only.
export async function runLoginAcceptance(page, base='http://127.0.0.1:5183', {diagnostic=false}={}) {
  page.setDefaultTimeout(6000)
  const results=[]
  let run=0
  const fresh=async(mode='component')=>{
    await page.goto(`${base}/tests/fixtures/aud07-login.html?mode=${mode}&run=${++run}#sign-in`)
    await page.getByRole('heading',{name:'Welcome back',exact:true}).waitFor()
    await page.getByRole('textbox',{name:'Email',exact:true}).fill('synthetic@example.invalid')
    await page.locator('input[type=password]').fill('synthetic-only')
  }
  const submit=()=>page.getByRole('button',{name:'Sign in',exact:true})
  const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  const record=async(name,run)=>{
    try { const evidence=await run();results.push({name,result:'pass',...evidence}) }
    catch(error) { results.push({name,result:'FAIL',error:error.message}) }
  }
  for (const kind of ['double-click','two-Enter-submits','click-then-Enter']) await record(kind,async()=>{
    await fresh()
    await page.locator('form').evaluate((form,kind)=>{
      const button=form.querySelector('button[type=submit]')
      // Native requestSubmit follows the form path used by Enter. Both actions
      // run in one task deliberately, before a React state commit can guard them.
      if(kind==='double-click'){button.click();button.click()}
      else if(kind==='two-Enter-submits'){form.requestSubmit();form.requestSubmit()}
      else{button.click();form.requestSubmit()}
    },kind)
    await page.waitForFunction(()=>window.loginFixture.posts.length>0)
    const counts=await page.evaluate(()=>({callbacks:window.loginFixture.callbacks,httpPosts:window.loginFixture.posts.length}))
    assert.equal(counts.callbacks,1,JSON.stringify(counts))
    assert.equal(counts.httpPosts,1,'one HTTP dispatch, excluding CSRF and its transport retry')
    assert.equal(await page.locator('form').getAttribute('aria-busy'),'true')
    assert.equal(await page.getByRole('button',{name:'Signing in…',exact:true}).isDisabled(),true)
    await page.evaluate(()=>window.loginFixture.respond(0))
    await page.getByRole('status').filter({hasText:'These credentials do not match our records.'}).waitFor()
    assert.equal(await submit().isEnabled(),true)
    await submit().click();await page.waitForFunction(()=>window.loginFixture.posts.length===2)
    return {...counts,retryPosts:2}
  })
  await record('native keyboard submission and pending Enter',async()=>{
    await fresh();await page.locator('input[type=password]').focus();await page.keyboard.press('Enter')
    await page.waitForFunction(()=>window.loginFixture.posts.length===1)
    await page.keyboard.press('Enter');await settle()
    assert.equal(await page.evaluate(()=>window.loginFixture.posts.length),1)
    await page.evaluate(()=>window.loginFixture.respond(0));await submit().waitFor()
    await page.locator('input[type=password]').focus();await page.keyboard.press('Enter')
    await page.waitForFunction(()=>window.loginFixture.posts.length===2)
  })
  await record('callback exception releases busy without exposing exception text',async()=>{
    await fresh();await page.evaluate(()=>{window.loginFixture.throwCallback=true})
    await submit().click()
    await page.getByRole('status').filter({hasText:'Couldn’t sign in'}).waitFor()
    assert.equal(await submit().isEnabled(),true)
    assert.equal((await page.locator('body').innerText()).includes('Synthetic callback failure'),false)
    await page.evaluate(()=>{window.loginFixture.throwCallback=false})
    await submit().click();await page.waitForFunction(()=>window.loginFixture.posts.length===1)
  })
  for (const kind of ['network','server','validation','csrf']) await record(`${kind} failure and legitimate retry`,async()=>{
    await fresh();await submit().click();await page.waitForFunction(()=>window.loginFixture.posts.length===1)
    if(kind==='network')await page.evaluate(()=>window.loginFixture.refuseNetwork(0))
    else if(kind==='csrf'){
      await page.evaluate(()=>window.loginFixture.respond(0,419,{}));await page.waitForFunction(()=>window.loginFixture.posts.length===2)
      await page.evaluate(()=>window.loginFixture.respond(1,419,{}))
    } else await page.evaluate(kind=>window.loginFixture.respond(0,kind==='server'?500:422,kind==='server'?{}:{message:'Check the highlighted fields.',errors:{email:['Synthetic required email']}}),kind)
    await page.getByRole('status').filter({hasText:'Couldn’t sign in'}).waitFor()
    assert.equal(await submit().isEnabled(),true)
    const before=await page.evaluate(()=>window.loginFixture.posts.length)
    await submit().click();await page.waitForFunction(n=>window.loginFixture.posts.length===n+1,before)
    return {beforeRetryPosts:before,csrfReplayPreserved:kind==='csrf'}
  })
  await record('component unmount and newer form suppress old feedback',async()=>{
    await fresh();await submit().click();await page.waitForFunction(()=>window.loginFixture.posts.length===1)
    await page.evaluate(()=>window.loginFixture.mount(false));await page.evaluate(()=>window.loginFixture.mount(true))
    await submit().click();await page.waitForFunction(()=>window.loginFixture.posts.length===2)
    await page.evaluate(()=>window.loginFixture.respond(0,422,{message:'Obsolete failure',code:'invalid_credentials'}));await settle()
    assert.equal(await page.getByRole('status').count(),0)
    assert.equal(await page.getByRole('button',{name:'Signing in…',exact:true}).isDisabled(),true)
    await page.evaluate(()=>window.loginFixture.respond(1));await submit().waitFor()
  })
  for (const outcome of ['success','verification','unbridgeable-success']) await record(`real App ignores obsolete ${outcome}`,async()=>{
    await fresh('app');await submit().click();await page.waitForFunction(()=>window.loginFixture.posts.length===1)
    // Real routing unmounts the first form. A fresh form starts a newer attempt.
    await page.evaluate(()=>{location.hash='forgot-password'})
    await page.getByRole('heading',{name:'Reset your password',exact:true}).waitFor()
    await page.evaluate(()=>{location.hash='sign-in'})
    await page.getByRole('heading',{name:'Welcome back',exact:true}).waitFor()
    await submit().click();await page.waitForFunction(()=>window.loginFixture.posts.length===2)
    await page.evaluate(outcome=>{
      const f=window.loginFixture
      if(outcome==='verification')f.respond(0,422,{code:'email_verification_required',message:'Verify your email before signing in.'})
      else f.respond(0,200,{data:outcome==='success'?f.owner:{...f.owner,email:'unmapped-owner@example.invalid'}})
    },outcome)
    await settle()
    assert.equal(await page.getByRole('heading',{name:'Welcome back',exact:true}).count(),1,'obsolete response cannot replace the newer form')
    assert.equal(await page.evaluate(()=>window.loginFixture.logout),0,'obsolete identity cannot log out a newer session')
    await page.evaluate(()=>window.loginFixture.respond(1,200,{data:window.loginFixture.owner}))
    await page.getByRole('navigation',{name:'Owner / Admin navigation',exact:true}).waitFor()
    return {obsoleteAdoption:false,unwantedLogout:0,newOwnerAdopted:true}
  })
  await record('real App unmount prevents old verification redirect',async()=>{
    await fresh('app');await submit().click();await page.waitForFunction(()=>window.loginFixture.posts.length===1)
    await page.evaluate(()=>window.loginFixture.replace())
    await page.getByRole('heading',{name:'Welcome back',exact:true}).waitFor()
    await page.evaluate(()=>window.loginFixture.respond(0,422,{code:'email_verification_required',message:'Obsolete verification'}))
    await settle()
    assert.equal(new URL(page.url()).hash,'#sign-in')
    assert.equal(await page.getByRole('heading',{name:'Welcome back',exact:true}).count(),1)
  })
  await record('real App retains current verification-required flow',async()=>{
    await fresh('app');await submit().click();await page.waitForFunction(()=>window.loginFixture.posts.length===1)
    await page.evaluate(()=>window.loginFixture.respond(0,422,{code:'email_verification_required',message:'Verify your email before signing in.'}))
    await page.waitForFunction(()=>location.hash==='#verify-email')
    assert.equal(await page.locator('.main-nav').count(),0)
  })
  await record('real App rejects unsupported current identity through existing logout',async()=>{
    await fresh('app');await submit().click();await page.waitForFunction(()=>window.loginFixture.posts.length===1)
    await page.evaluate(()=>window.loginFixture.respond(0,200,{data:{...window.loginFixture.owner,email:'unmapped-owner@example.invalid'}}))
    await page.getByText('This account doesn’t have a workspace configured yet. Contact the clinic administrator.',{exact:true}).waitFor()
    assert.equal(await page.evaluate(()=>window.loginFixture.logout),1)
    assert.equal(await page.locator('.main-nav').count(),0)
  })
  const ownerNav=()=>page.getByRole('navigation',{name:'Owner / Admin navigation',exact:true})
  const signInOwner=async()=>{
    await fresh('app');await submit().click();await page.waitForFunction(()=>window.loginFixture.posts.length===1)
    await page.evaluate(()=>window.loginFixture.respond(0,200,{data:window.loginFixture.owner}));await ownerNav().waitFor()
  }
  await record('older Staff success cannot replace an already authenticated newer Owner',async()=>{
    await fresh('app');await submit().click();await page.waitForFunction(()=>window.loginFixture.posts.length===1)
    await page.evaluate(()=>{location.hash='forgot-password'});await page.getByRole('heading',{name:'Reset your password',exact:true}).waitFor()
    await page.evaluate(()=>{location.hash='sign-in'});await page.getByRole('heading',{name:'Welcome back',exact:true}).waitFor()
    await submit().click();await page.waitForFunction(()=>window.loginFixture.posts.length===2)
    await page.evaluate(()=>window.loginFixture.respond(1,200,{data:window.loginFixture.owner}));await ownerNav().waitFor()
    await page.evaluate(()=>window.loginFixture.respond(0,200,{data:window.loginFixture.staff}));await settle()
    assert.equal(await ownerNav().count(),1)
    assert.equal(await page.getByRole('navigation',{name:'Staff navigation',exact:true}).count(),0)
  })
  await record('StrictMode older bootstrap cannot replace an in-flight newer login',async()=>{
    await page.goto(`${base}/tests/fixtures/aud07-login.html?mode=app&holdBootstrap=1&run=${++run}#sign-in`)
    await page.waitForFunction(()=>window.loginFixture.probes.length>=2)
    await page.evaluate(()=>window.loginFixture.probes.at(-1).resolve(Response.json({}, {status:401})))
    await page.getByRole('heading',{name:'Welcome back',exact:true}).waitFor()
    await submit().click();await page.waitForFunction(()=>window.loginFixture.posts.length===1)
    await page.evaluate(()=>window.loginFixture.probes[0].resolve(Response.json({data:window.loginFixture.staff})));await settle()
    assert.equal(await page.getByRole('heading',{name:'Welcome back',exact:true}).count(),1)
    await page.evaluate(()=>window.loginFixture.respond(0,200,{data:window.loginFixture.owner}));await ownerNav().waitFor()
  })
  await record('current session invalidation still signs out after generation revocation',async()=>{
    await signInOwner()
    await page.evaluate(()=>{window.loginFixture.holdMe=true;window.loginFixture.invalidate()})
    await page.waitForFunction(()=>window.loginFixture.probes.length===1)
    await page.evaluate(()=>window.loginFixture.probes[0].resolve(Response.json({}, {status:401})))
    await page.getByRole('heading',{name:'Welcome back',exact:true}).waitFor()
    assert.equal(await page.locator('.main-nav').count(),0)
    await page.getByText('Your session has ended. Sign in again.',{exact:true}).waitFor()
  })
  await record('old session revalidation cannot clear a newer login',async()=>{
    await signInOwner()
    await page.evaluate(()=>{window.loginFixture.holdMe=true;window.loginFixture.invalidate()})
    await page.waitForFunction(()=>window.loginFixture.probes.length===1)
    await page.getByRole('button',{name:'Sign out',exact:true}).click()
    await page.getByRole('dialog',{name:'Sign out?',exact:true}).getByRole('button',{name:'Sign out',exact:true}).click()
    await page.getByRole('heading',{name:'Welcome back',exact:true}).waitFor()
    await submit().click();await page.waitForFunction(()=>window.loginFixture.posts.length===2)
    await page.evaluate(()=>window.loginFixture.respond(1,200,{data:window.loginFixture.owner}));await ownerNav().waitFor()
    await page.evaluate(()=>window.loginFixture.probes[0].resolve(Response.json({}, {status:401})));await settle()
    assert.equal(await ownerNav().count(),1)
  })
  await record('old sign-out completion cannot clear a newer login',async()=>{
    await signInOwner();await page.evaluate(()=>{window.loginFixture.holdLogout=true})
    await page.getByRole('button',{name:'Sign out',exact:true}).click()
    await page.getByRole('dialog',{name:'Sign out?',exact:true}).getByRole('button',{name:'Sign out',exact:true}).click()
    await page.waitForFunction(()=>window.loginFixture.logouts.length===1)
    await page.evaluate(()=>window.loginFixture.invalidate())
    await page.getByRole('heading',{name:'Welcome back',exact:true}).waitFor()
    await submit().click();await page.waitForFunction(()=>window.loginFixture.posts.length===2)
    await page.evaluate(()=>window.loginFixture.respond(1,200,{data:window.loginFixture.owner}));await ownerNav().waitFor()
    await page.evaluate(()=>window.loginFixture.logouts[0].resolve(new Response(null,{status:204})));await settle()
    assert.equal(await ownerNav().count(),1)
  })
  for(const width of [375,430,768,1024,1440])await record(`accessible login at ${width}px`,async()=>{
    await page.setViewportSize({width,height:900});await fresh()
    await page.keyboard.press('Tab');await submit().focus()
    assert.equal(await submit().evaluate(el=>el===document.activeElement&&getComputedStyle(el).outlineStyle!=='none'),true)
    const target=await submit().boundingBox();assert.ok(target.width>=44&&target.height>=44,'usable submit target')
    assert.equal(await page.getByRole('textbox',{name:'Email',exact:true}).count(),1)
    assert.equal(await page.locator('input[autocomplete=current-password]').count(),1)
    await page.keyboard.press('Enter');await page.waitForFunction(()=>window.loginFixture.posts.length===1)
    await page.evaluate(()=>window.loginFixture.respond(0));await submit().waitFor()
    assert.equal(await page.getByRole('status').filter({hasText:'Couldn’t sign in'}).count(),1)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    return {target:{width:target.width,height:target.height},overflow:false}
  })
  if(!diagnostic)assert.equal(results.filter(row=>row.result==='FAIL').length,0,JSON.stringify(results))
  return results
}
