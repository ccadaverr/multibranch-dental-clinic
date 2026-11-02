import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {clinic} from '../src/clinic-config.js'
import {publicViewFromHash} from '../src/public-route.js'
import {bootstrapSession} from '../src/session-bootstrap.js'
const require=createRequire(import.meta.url)
const bundle=await build({stdin:{contents:"export * from './src/pages/PublicSite.jsx'; export * from './src/pages/PublicLegal.jsx'; export * from './src/pages/PublicChrome.jsx'; export * from './src/StartupLoading.jsx'; export * from './src/pages/PatientRegister.jsx'; export * from './src/pages/EmailVerification.jsx'; export {Login} from './src/layout.jsx';",resolveDir:process.cwd()},bundle:true,write:false,loader:{'.css':'empty'},platform:'node',format:'esm',plugins:[{name:'react',setup(b){b.onResolve({filter:/^react$/},()=>({path:pathToFileURL(require.resolve('react')).href,external:true}))}}]})
const ui=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'))
const render=(Component,props={})=>renderToStaticMarkup(React.createElement(Component,props))
const page=render(ui.PublicSite)

test('public website renders complete semantic sections and a single primary heading',()=>{
  assert.match(page,/<header/);assert.match(page,/<main/);assert.match(page,/<footer/)
  for(const id of ['home','how-it-works','services','branches','features','faq'])assert.match(page,new RegExp(`id="${id}"`))
  assert.equal((page.match(/<h1[ >]/g)||[]).length,1)
  for(const heading of ['From booking to receipt in four steps','Find the care you need','Find the branch near you','Questions patients ask','In an emergency'])assert.ok(page.includes(heading),heading)
})
test('public navigation has real anchors, account actions and an accessible mobile menu',()=>{
  const html=render(ui.PublicHeader)
  for(const hash of ['home','services','branches','how-it-works','faq','sign-in','create-account'])assert.ok(html.includes(`href="#${hash}"`),hash)
  assert.match(html,/aria-controls="public-navigation"/)
  assert.match(html,/aria-expanded="false"/)
  assert.match(html,/aria-label="Open navigation"/)
  assert.match(html,/Skip to content/)
  assert.doesNotMatch(html,/href="#"/)
})
test('only the clinic name and contact are a built-in fallback; branches, services and FAQ load from the API',()=>{
  assert.equal(clinic.phoneDisplay,'0922 878 7341')
  assert.equal(clinic.email,'danaroxas.dentalclinic@gmail.com')
  // Server-rendered (no API): loading states, never invented branches or services.
  assert.match(page,/aria-label="Loading services"/)
  assert.match(page,/aria-label="Loading branches"/)
  for(const fact of ['MacArthur','0933 867 8725','8:00 PM','Oral Prophylaxis'])assert.ok(!page.includes(fact),fact)
  const source=readFileSync('src/pages/PublicSite.jsx','utf8')+readFileSync('src/pages/PublicChrome.jsx','utf8')
  for(const api of ["usePublicData('branches')","usePublicData('services')","usePublicData('faq')"])assert.ok(source.includes(api),api)
})
test('the public site shows only real product features: no HMO, statistics, testimonials, partner logos or placeholders',()=>{
  const pages=[page,render(ui.PublicHeader),render(ui.PublicFooter),render(ui.PatientRegister,{onRegister:()=>{},onCancel:()=>{}}),render(ui.Login,{onLogin:()=>{}}),render(ui.PublicLegal,{kind:'privacy'}),render(ui.PublicLegal,{kind:'terms'})]
  for(const html of pages){
    assert.doesNotMatch(html,/\bHMO\b/i)
    assert.doesNotMatch(html,/testimonial|partner|lorem ipsum|coming soon|illustrative preview|\b\d{2,}\+? (patients|clients|reviews)|★|rating/i)
  }
  for(const feature of ['Online booking','Email updates','Secure messaging','Online payment with receipt'])assert.ok(page.includes(feature),feature)
  assert.ok(!readFileSync('index.html','utf8').match(/\bHMO\b/i))
})
test('footer has quick links, account links, the RA 10173 note, privacy and terms links and the current year',()=>{
  const html=render(ui.PublicFooter)
  assert.ok(html.includes(`© ${new Date().getFullYear()}`))
  for(const href of ['#services','#branches','#sign-in','#create-account','#privacy','#terms'])assert.ok(html.includes(`href="${href}"`),href)
  assert.match(html,/RA 10173/)
  for(const kind of ['privacy','terms']){const legal=render(ui.PublicLegal,{kind});assert.match(legal,/Draft — to be confirmed by the clinic/);assert.equal((legal.match(/<h1[ >]/g)||[]).length,1)}
  assert.equal(publicViewFromHash('#privacy'),'privacy');assert.equal(publicViewFromHash('#terms'),'terms')
})
test('auth screens share the landing header, the two-column layout, a website return path and the footer',()=>{
  for(const html of [render(ui.Login,{onLogin:()=>{},onShowRegister:()=>{}}),render(ui.PatientRegister,{onRegister:()=>{},onCancel:()=>{}}),render(ui.EmailVerification,{email:'private@example.test',onVerify:()=>{},onResend:()=>{},onBack:()=>{}})]){
    assert.match(html,/aria-label="Main"/)
    assert.match(html,/class="lp-container lp-auth-grid"/)
    assert.match(html,/href="#home"/)
    assert.match(html,/<footer/)
  }
})
test('the create-account card: labels, sign-in email, PH phone hint, password help, consent links, full-width button and sign-in link',()=>{
  const html=render(ui.PatientRegister,{onRegister:()=>{},onCancel:()=>{}})
  assert.match(html,/Create your account/)
  assert.match(html,/Book visits, pay online and message the clinic in one place\./)
  assert.match(html,/Philippines \+63/)
  assert.match(html,/type="tel"/)
  assert.match(html,/inputMode="tel"/)
  assert.match(html,/Philippine mobile, e\.g\. 917 123 4567/)
  assert.match(html,/type="date" required="" max=/)
  assert.match(html,/This is the email you will sign in with/)
  assert.equal((html.match(/class="auth-password-toggle"/g)||[]).length,2)
  assert.match(html,/At least 8 characters/)
  assert.match(html,/href="#privacy"/);assert.match(html,/href="#terms"/)
  assert.match(html,/type="checkbox"/)
  assert.match(html,/btn-full/)
  assert.match(html,/Already have an account\?/)
})
test('verification preserves masked destination, OTP input and resend control',()=>{
  const html=render(ui.EmailVerification,{email:'private@example.test',onVerify:()=>{},onResend:()=>{},onBack:()=>{}})
  assert.match(html,/pr•••••@example.test/)
  assert.match(html,/autoComplete="one-time-code"/)
  assert.match(html,/Resend code/)
  assert.doesNotMatch(html,/SMTP|Laravel|SMS/)
})
test('public hash destinations resolve to real auth screens without a persona picker',()=>{
  assert.equal(publicViewFromHash('#create-account'),'register')
  assert.equal(publicViewFromHash('#sign-in'),'login')
  assert.equal(publicViewFromHash('#verify-email'),'verify')
  for(const section of ['','#home','#about','#features','#portal','#contact'])assert.equal(publicViewFromHash(section),'home')
})
test('startup indicator is branded and announces only one loading message',()=>{
  const html=render(ui.LoadingIndicator)
  assert.ok(html.includes(clinic.nameLine));assert.match(html,/src="\/images\/logo.png"/)
  assert.equal((html.match(/role="status"/g)||[]).length,1)
  assert.match(html,/aria-hidden="true"/)
  assert.doesNotMatch(html,/<button|tabindex/i)
  assert.doesNotMatch(render(ui.StartupLoading),/role="status"/,'fast loads initially render no flashing indicator')
})
test('startup returns immediately on readiness and cancels its I/O timeout',async()=>{
  let canceled=false,signal
  const result=await bootstrapSession(async options=>{signal=options.signal;return {ok:true,data:{id:'public-id'}}},{setTimer:()=>42,clearTimer:id=>{assert.equal(id,42);canceled=true}})
  assert.equal(result.ok,true);assert.equal(canceled,true);assert.equal(signal.aborted,false)
})
test('a hung startup request is aborted and can leave loading instead of waiting indefinitely',async()=>{
  let expire
  const result=bootstrapSession(({signal})=>new Promise(resolve=>signal.addEventListener('abort',()=>resolve({ok:false,kind:'network'}))),{setTimer:callback=>{expire=callback;return 1},clearTimer:()=>{}})
  expire();assert.deepEqual(await result,{ok:false,kind:'network'})
})
test('loader uses only delayed reveal with cleanup and disables animation for reduced motion',()=>{
  const source=readFileSync('src/StartupLoading.jsx','utf8'),css=readFileSync('src/public-site.css','utf8')
  assert.match(source,/setTimeout\(\(\)=>setVisible\(true\),150\)/)
  assert.match(source,/clearTimeout\(timer\)/)
  assert.match(css,/@media \(prefers-reduced-motion:reduce\)[\s\S]*\.startup-brand,\.startup-track::after,\.site-ready \{ animation:none; \}/)
  assert.doesNotMatch(source,/3000|minimumDuration/)
})

test('verification reload offers recipient recovery without persisting credentials',()=>{
  const html=render(ui.EmailVerification,{onVerify:()=>{},onResend:()=>{},onBack:()=>{}})
  assert.match(html,/Registration email/)
  assert.match(html,/Continue verification/)
  assert.match(html,/autoComplete="one-time-code"/)
})
test('startup timeout settles even when a session adapter ignores abort',async()=>{
  let expire,signal,cleared=false
  const pending=bootstrapSession(options=>{signal=options.signal;return new Promise(()=>{})},{setTimer:fn=>{expire=fn;return 7},clearTimer:id=>{assert.equal(id,7);cleared=true}})
  expire()
  assert.deepEqual(await pending,{ok:false,kind:'network'})
  assert.equal(signal.aborted,true);assert.equal(cleared,true)
})
test('startup converts a rejected session read into recoverable unavailability',async()=>{
  assert.deepEqual(await bootstrapSession(async()=>{throw new Error('offline')}),{ok:false,kind:'network'})
})
test('api.me forwards the exact AbortSignal to fetch and returns its abort as network failure',async()=>{
  const api=await import('../src/api-client.js')
  const original=globalThis.fetch,controller=new AbortController()
  try {
    globalThis.fetch=(url,options)=>{
      assert.ok(url.endsWith('/api/me'))
      assert.equal(options.signal,controller.signal)
      return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted'))))
    }
    const pending=api.me({signal:controller.signal});controller.abort()
    assert.equal((await pending).kind,'network')
  } finally {globalThis.fetch=original}
})

test('every lazy page resolves to its named component export',async()=>{
  const source=readFileSync('src/App.jsx','utf8')
  const imports=[...source.matchAll(/import\('(.+?)'\)\.then\(m=>\(\{default:m\.(\w+)\}\)\)/g)]
  assert.equal(imports.length,40) // 25 canonical modules + white-label, patient portal, assistant answers, automations, closed dates, accepted HMOs, wording approvals, counter registration, and archives
  for(const [,path,name] of imports){
    const result=await build({entryPoints:[`src/${path.slice(2)}`],bundle:true,write:false,loader:{'.css':'empty'},metafile:true,platform:'node',format:'esm',external:['react']})
    assert.ok(Object.values(result.metafile.outputs).some(output=>output.exports.includes(name)),name)
  }
})

test('auth prioritizes forms and removes repeated brand/marketing panels',()=>{
  const login=render(ui.Login,{onLogin:()=>{},onShowRegister:()=>{}})
  assert.match(login,/Welcome back/)
  assert.match(login,/Sign in to continue to your clinic portal/)
  assert.match(login,/Create an account/)
  for(const html of [login,render(ui.PatientRegister,{onRegister:()=>{},onCancel:()=>{}}),render(ui.EmailVerification,{email:'private@example.test'})]){
    assert.doesNotMatch(html,/auth-intro|auth-mobile-brand|Care, thoughtfully connected|Appointments and visit details|Clinic updates and messages|Billing and receipt history/)
    assert.match(html,/Back to the clinic website/)
  }
})
test('create-account validation: required fields, email, phone, password rules, matching passwords and consent',()=>{
  const ok={first_name:'Ana',last_name:'Cruz',date_of_birth:'2000-01-02',email:'ana@example.test',password:'Secret123',password_confirmation:'Secret123'}
  assert.deepEqual(ui.validateRegistration(ok,{phoneOk:true,consent:true,today:'2026-10-18'}),{})
  const bad=ui.validateRegistration({first_name:' ',last_name:'',date_of_birth:'2030-01-01',email:'ana@',password:'abcdefgh',password_confirmation:'x'},{phoneOk:false,phoneReason:'Enter a valid phone number for Philippines.',consent:false,today:'2026-10-18'})
  assert.deepEqual(Object.keys(bad).sort(),['consent','date_of_birth','email','first_name','last_name','password','password_confirmation','phone'])
  assert.match(bad.password,/a number/)
  assert.equal(ui.validateRegistration({...ok,password:'short1',password_confirmation:'short1'},{phoneOk:true,consent:true}).password,'Your password needs at least 8 characters.')
  assert.equal(ui.validateRegistration({...ok,date_of_birth:'2026-05-01'},{phoneOk:true,consent:true,today:'2026-10-18'}).date_of_birth,undefined)
  assert.equal(ui.validateRegistration({...ok,date_of_birth:'2026-10-19'},{phoneOk:true,consent:true,today:'2026-10-18'}).date_of_birth,'The date of birth cannot be in the future.')
  assert.equal(ui.validateRegistration({...ok,date_of_birth:'1900-01-01'},{phoneOk:true,consent:true,today:'2026-10-18'}).date_of_birth,'Date of birth must be within the last 120 years.')
  assert.equal(ui.passwordStrength('').label,'')
  assert.equal(ui.passwordStrength('abcdefgh').label,'Weak')
  assert.equal(ui.passwordStrength('abcdefg1').label,'Fair')
  assert.equal(ui.passwordStrength('abcdefgh1234').label,'Good')
  assert.equal(ui.passwordStrength('Abcdefgh1234!').label,'Strong')
  const verification=render(ui.EmailVerification,{email:'private@example.test',initialResendAvailableAt:new Date(Date.now()+60000).toISOString()})
  assert.match(verification,/We sent a 6-digit verification code to/)
  assert.match(verification,/class="auth-otp"/)
  assert.match(verification,/disabled=""[^>]*><span>Resend code/)
  assert.doesNotMatch(verification,/private@example.test/)
})
