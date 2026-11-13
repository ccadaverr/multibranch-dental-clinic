// Render real intake, patient-ID and follow-up forms against in-memory API adapters.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { build } from "esbuild";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE);
const source = `
import React from 'react';import {createRoot} from 'react-dom/client';
import {SelectWithOther} from './src/components.jsx';import {SelfRegistered,IdCheck} from './src/pages/CounterIntake.jsx';import {FollowupPanel} from './src/pages/ServerFollowups.jsx';
window.other={calls:[],feedback:[],mode:'id'};
const generation=()=>1;
function Shared(){const[v,setV]=React.useState('Other'),[detail,setDetail]=React.useState('');return <form onSubmit={e=>{e.preventDefault();window.other.calls.push({kind:'shared',value:v,detail})}}><SelectWithOther label="Relationship" required value={v} onChange={setV} options={['Child','Other']} otherValue={detail} onOtherChange={setDetail} placeholder="e.g., Cousin"/><button type="submit">Save relationship</button></form>}
function Harness(){const[mode,setMode]=React.useState('id');window.other.setMode=setMode;return mode==='shared'?<Shared/>:mode==='intake'?<SelfRegistered store={{session:{serverUserId:'staff',userId:'staff',role:'staff',branchId:'b1'},state:{}}} toast={()=>{}}/>:mode==='followup'?<FollowupPanel patientId="p1" role="staff" branches={[{id:'b1',name:'Synthetic branch'}]} store={{getAuthGeneration:generation,session:{serverUserId:'staff',userId:'staff',role:'staff',branchId:'b1'}}} toast={(...x)=>window.other.feedback.push(x)}/>:<IdCheck patientId="p1" toast={(...x)=>window.other.feedback.push(x)}/>}createRoot(document.getElementById('root')).render(<Harness/>);`;
const api = `
export const onSessionInvalidated=()=>()=>{};
export const pendingIntake=async()=>({ok:true,data:[{id:'intake1',reference:'SYNTHETIC',channel:'phone',branch_ref:'b1',self:{first_name:'Synthetic',last_name:'Patient'},id_type:'philid',join_queue:false}],meta:{id_types:{philid:'PhilID',other:'Other valid ID'}}});
export const getPatientRecord=async()=>({ok:true,data:{id:'p1',profile_access:'full'}});
const refuse=(kind,id,body)=>{window.other.calls.push({kind,id,body});return Promise.resolve({ok:false,kind:'validation',message:'Synthetic refusal',errors:{other_details:['Synthetic specify error']}})};
export const verifyPatientId=(id,body)=>{if(window.other.receipt){window.other.calls.push({kind:'id',id,body});return Promise.resolve({ok:true,data:window.other.receipt})}return refuse('id',id,body)},confirmIntake=(id,body)=>refuse('intake',id,body);
export const patientFollowups=async()=>({ok:true,data:[]});
export const createFollowup=body=>refuse('followup','p1',body);
export const followups=patientFollowups;
const unexpected=()=>{throw Error('Unexpected operation')};
export const reportSessionInvalidated=unexpected,listAppointments=unexpected,getAppointment=unexpected,appointmentAvailability=unexpected,appointmentRecommendation=unexpected,createAppointment=unexpected,rescheduleAppointment=unexpected,cancelAppointmentRemote=unexpected,transitionAppointment=unexpected,searchPatients=unexpected;
export const updateFollowup=unexpected,cancelIntake=unexpected,offerOnlineAccount=unexpected,requestHandover=unexpected,branchPosterUrl=unexpected,intakeCode=unexpected,refreshIntakeCode=unexpected;
`;
const out = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: "jsx" }, bundle: true, write: false, format: "iife", platform: "browser", loader: { ".css": "empty" }, plugins: [{ name: "isolated-other-api", setup(b) {
  b.onResolve({ filter: /api-client\.js$/ }, () => ({ path: "api", namespace: "synthetic" }));
  b.onLoad({ filter: /.*/, namespace: "synthetic" }, () => ({ contents: api, loader: "js" }));
  b.onResolve({ filter: /Scheduling\.jsx$/ }, () => ({ path: "booking", namespace: "unused" }));
  b.onLoad({ filter: /.*/, namespace: "unused" }, () => ({ contents: "export const AppointmentForm=()=>null", loader: "js" }));
} }] });
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/h.js" ? "text/javascript" : "text/html");
  res.end(req.url === "/h.js" ? out.outputFiles[0].contents : '<!doctype html><div id="root"></div><script src="/h.js"><\/script>');
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + server.address().port;
let browser;
const completed = [];
try {
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const p = await browser.newPage(), errors = [];
  p.setDefaultTimeout(4e3);
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route("**/*", (r) => new URL(r.request().url()).origin === origin ? r.continue() : r.abort());
  const choose = () => p.getByRole("combobox", { name: /^ID shown/ }), detail = () => p.getByRole("textbox", { name: /^Specify ID type/ });
  for (const mode of ["id", "intake"]) {
    await p.goto(origin);
    await p.waitForFunction(() => window.other?.setMode);
    if (mode === "intake") {
      await p.evaluate(() => window.other.setMode("intake"));
      await p.getByRole("button", { name: "Review and confirm", exact: true }).click();
    }
    await choose().selectOption("other");
    if (mode === "intake") await p.getByRole("checkbox").check();
    const submit2 = p.getByRole("button", { name: mode === "id" ? "ID checked" : "Confirm", exact: true });
    await detail().fill("   ");
    await detail().blur();
    assert.equal(await submit2.isDisabled(), true);
    assert.equal(await p.evaluate(() => window.other.calls.length), 0);
    await detail().fill(" Company ID ");
    await submit2.click();
    await p.getByRole("alert").first().waitFor();
    assert.equal((await p.evaluate(() => window.other.calls))[0].body.other_details, "Company ID");
    assert.equal(await detail().inputValue(), " Company ID ");
    await choose().selectOption("philid");
    assert.equal(await detail().count(), 0);
    await choose().selectOption("other");
    assert.equal(await detail().inputValue(), "");
    assert.equal(await submit2.isDisabled(), true);
    await choose().selectOption("philid");
    await submit2.click();
    await p.waitForFunction(() => window.other.calls.length === 2);
    assert.equal("other_details" in (await p.evaluate(() => window.other.calls))[1].body, false);
    completed.push(mode + ": whitespace refusal, trimmed payload, server-error retention, hidden clear, clean ordinary payload");
  }
  await p.goto(origin);
  await p.waitForFunction(() => window.other?.setMode);
  await p.evaluate(() => window.other.setMode("followup"));
  await p.getByRole("button", { name: "Add a follow-up", exact: true }).click();
  const reason = p.getByRole("combobox", { name: /^Follow-up reason/ });
  await reason.selectOption("Other");
  const custom = p.getByRole("textbox", { name: /^Specify reason/ }), submit = p.getByRole("button", { name: "Add follow-up", exact: true });
  await custom.fill("   ");
  assert.equal(await submit.isDisabled(), true);
  assert.equal(await p.evaluate(() => window.other.calls.length), 0);
  await custom.fill(" Review healing ");
  await submit.click();
  await p.getByRole("alert").first().waitFor();
  assert.equal((await p.evaluate(() => window.other.calls))[0].body.reason, "Review healing");
  assert.equal(await custom.inputValue(), " Review healing ");
  await reason.selectOption("Suture Removal");
  assert.equal(await custom.count(), 0);
  await reason.selectOption("Other");
  assert.equal(await custom.inputValue(), "");
  assert.equal(await submit.isDisabled(), true);
  await reason.selectOption("Suture Removal");
  await submit.click();
  await p.waitForFunction(() => window.other.calls.length === 2);
  assert.equal((await p.evaluate(() => window.other.calls))[1].body.reason, "Suture Removal");
  assert.deepEqual(await p.evaluate(() => window.other.feedback), []);
  completed.push("followup: whitespace refusal, trimmed payload, error retention, hidden clear, ordinary reason");
  // A real browser's native constraint validation must also protect shared
  // Other fields, including implicit keyboard submission.
  await p.goto(origin); await p.waitForFunction(()=>window.other?.setMode);
  await p.evaluate(()=>window.other.setMode('shared'));
  const relationship=p.getByRole('textbox',{name:/^Specify Relationship/}), save=p.getByRole('button',{name:'Save relationship'});
  for(const value of ['', '   ']) {
    await relationship.fill(value);await save.click();
    assert.equal(await relationship.evaluate(el=>el.checkValidity()),false,'blank/whitespace Other must fail native form validation');
    assert.equal(await p.evaluate(()=>window.other.calls.length),0);
  }
  await relationship.fill('Cousin');await relationship.press('Enter');
  await p.waitForFunction(()=>window.other.calls.length===1);
  assert.deepEqual(await p.evaluate(()=>window.other.calls),[{kind:'shared',value:'Other',detail:'Cousin'}]);
  await p.getByRole('combobox',{name:/Relationship/}).selectOption('Child');assert.equal(await relationship.count(),0);
  await p.getByRole('combobox',{name:/Relationship/}).selectOption('Other');assert.equal(await relationship.inputValue(),'');
  completed.push('shared: native empty/whitespace refusal, keyboard submission, standard-choice reset');
  for(const detail of [undefined,'Different ID type','Company ID']) {
    await p.goto(origin);await p.waitForFunction(()=>window.other?.setMode);
    await choose().selectOption('other');await p.getByRole('textbox',{name:/^Specify ID type/}).fill(' Company ID ');
    await p.evaluate(detail=>{window.other.receipt={id_type:'other',id_verified_at:'2026-11-13T08:00:00+08:00',...(detail===undefined?{}:{other_details:detail})}},detail);
    await p.getByRole('button',{name:'ID checked',exact:true}).click();
    if(detail==='Company ID') {
      await p.getByRole('status').filter({hasText:'ID checked: Other valid ID (Company ID)'}).waitFor();
      assert.deepEqual(await p.evaluate(()=>window.other.feedback),[['ID check recorded (type only).','success']]);
    } else {
      await p.getByRole('alert').filter({hasText:'could not be confirmed'}).waitFor();
      assert.deepEqual(await p.evaluate(()=>window.other.feedback),[]);
      assert.equal(await p.getByRole('button',{name:'ID checked',exact:true}).isDisabled(),true);
      assert.equal(await p.getByRole('textbox',{name:/^Specify ID type/}).inputValue(),' Company ID ');
    }
    assert.equal(await p.evaluate(()=>window.other.calls.length),1);
    completed.push('id: '+String(detail)+' receipt '+(detail==='Company ID'?'confirmed':'refused without success'));
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: completed.length, completed }, null, 2));
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
