// Database-free rendered regressions. All data/refreshes are synthetic; external requests are refused.
// PLAYWRIGHT_MODULE must point to an already installed package. QA_BASELINE=1 reads production bytes from HEAD.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
const require2 = createRequire(import.meta.url);
const { chromium } = require2(process.env.PLAYWRIGHT_MODULE);
const source = `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {DentistQueue} from './src/pages/DentistQueue.jsx';
import {TreatmentPage} from './src/pages/EncounterWorkspace.jsx';
import {SearchInput,Field} from './src/components.jsx';
import {TemplateEditor} from './src/pages/Automations.jsx';
import {StaffOnDuty} from './src/pages/StaffOnDuty.jsx';
import {MonthCalendar} from './src/pages/DentistSchedule.jsx';
import {dentistFixture} from './tests/support/den-ui-01-fixture.js';
import {setClockSource} from './src/clock.js';
import './src/styles.css'; import './src/foundation.css'; import './src/patient.css'; import './src/polish.css'; import './src/automations.css';
setClockSource(()=>new Date('2026-11-01T10:00:00+08:00'));
window.batch={calls:0,commands:0,resolve:null};
function Harness(){
 const [query,setQuery]=React.useState(''),searchRef=React.useRef(null);window.batch.searchMatchesRef=()=>searchRef.current===document.querySelector('[aria-label="Shared clear test"]');
 const [mode,setMode]=React.useState('queue'),[date,setDate]=React.useState('2026-11-12'),[status,setStatus]=React.useState('ready');
 window.batch.mode=setMode;window.batch.date=setDate;window.batch.status=setStatus;
 const fixture=dentistFixture();fixture.state.queue=[{id:'q1',server:true,patientId:'p1',patientName:'Synthetic queue patient',service:'Synthetic service',dentistId:'d1',branchId:'b1',clinicDate:'2026-11-01',status:'Waiting',visitStatus:'Checked In',visitId:'v1',revision:1,queueNumber:1}];const store={...fixture,appointmentsStatus:status,queueSnapshot:{date:'2026-11-01',truncated:false},appointmentFlow:{refresh:()=>{window.batch.calls++;return new Promise(r=>window.batch.resolve=r)},queueCommand:()=>window.batch.commands++}};
 return mode==='searchClear'?<Field label="Shared clear test"><SearchInput ref={searchRef} value={query} onChange={setQuery} onClear={()=>setQuery('')} ariaLabel="Shared clear test"/></Field>:mode==='preview'?<TemplateEditor template={{key:'synthetic',name:'Synthetic email',revision:1,subject:'Synthetic subject',body:'Synthetic body',placeholders:[],owner_approval:{by:'Fixture'},approved:true}} onChanged={()=>{}} toast={()=>{}} showTest={false}/>:mode==='sharedSearch'?<Field label="Shared search test"><SearchInput value="Illustrative input text" onChange={()=>{}} ariaLabel="Shared search test"/></Field>:mode==='calendar'?<div className="den-workspace"><MonthCalendar date={date} today="2026-11-12" onChange={setDate} read={{status:'ready',complete:true,rows:[{date:'2026-11-11'}]}}/></div>:mode==='duty'?<StaffOnDuty session={{serverUserId:'fixture'}} activeBranch="All Branches"/>:mode==='encounter'?<TreatmentPage store={store} context={{queueEntryId:'missing'}} setPage={()=>{}}/>:<DentistQueue store={store} setPage={()=>{}}/>;
}createRoot(document.getElementById('root')).render(<Harness/>);`;
const bundle = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: "jsx" }, bundle: true, write: false, outfile: "harness.js", format: "iife", platform: "browser", plugins: [{ name: "isolated-duty-and-baseline", setup(b) {
  b.onLoad({ filter: /[\\/]src[\\/].*\.(jsx|js|css)$/ }, (args) => {
    const rel = args.path.slice(process.cwd().length + 1).replaceAll('\\', '/');
    let contents = process.env.QA_BASELINE === "1" ? execFileSync("git", ["show", "HEAD:" + rel], { encoding: "utf8" }) : readFileSync(args.path, "utf8");
    if (rel === "src/pages/StaffOnDuty.jsx") contents = contents.replace("import { workSchedulesDuty } from '../api-client.js'", "const workSchedulesDuty=()=>{window.batch.calls++;return new Promise(r=>window.batch.resolve=r)}");
    if (rel === "src/pages/Automations.jsx") contents = contents.replace("previewMessageTemplate,", "previewMessageTemplate as unusedPreviewMessageTemplate,") + "\nconst previewMessageTemplate=()=>{window.batch.calls++;return new Promise(r=>window.batch.resolve=r)}";
    return { contents, loader: rel.endsWith(".css") ? "css" : "jsx" };
  });
} }] });
const server = createServer((req, res) => {
  const f = bundle.outputFiles.find((f2) => f2.path.replaceAll('\\', '/').endsWith(req.url));
  if (f) {
    res.setHeader("Content-Type", req.url.endsWith(".css") ? "text/css" : "text/javascript");
    res.end(f.contents);
  } else if (req.url === "/") {
    res.setHeader("Content-Type", "text/html");
    res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/harness.css"><div id="root"></div><script src="/harness.js"><\/script>');
  } else {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + server.address().port;
let browser;
const completed = [];
try {
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const p = await browser.newPage(), errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.setDefaultTimeout(4e3);
  await p.route("**/*", (r) => new URL(r.request().url()).origin === origin ? r.continue() : r.abort());
  async function check(name, run) {
    await p.goto(origin);
    await p.waitForFunction(() => window.batch?.mode);
    await run();
    assert.deepEqual(errors, []);
    completed.push(name);
    console.log("PASS " + name);
  }
  if (!process.env.QA_CASE || process.env.QA_CASE === "queue") for (const width of [375, 1440]) await check("GEN-13 queue icon/pending/duplicate/recovery " + width, async () => {
    await p.setViewportSize({ width, height: 1e3 });
    const b = p.getByRole("button", { name: "Refresh queue", exact: true });
    await b.waitFor();
    assert.equal(await b.textContent(), "");
    assert.equal(await b.locator("svg").count(), 1);
    const target = await b.boundingBox();
    assert.ok(target.width >= 44 && target.height >= 44);
    await b.focus();
    assert.ok(await b.evaluate((e) => getComputedStyle(e).outlineStyle !== "none"));
    await p.keyboard.press("Enter");
    await p.waitForFunction(() => window.batch.calls === 1);
    assert.equal(await b.isDisabled(), true);
    assert.equal(await b.getAttribute("aria-busy"), "true");
    assert.match(await b.getAttribute("class"), /is-spinning/);
    await b.evaluate((e) => {
      e.click();
      e.click();
    });
    assert.equal(await p.evaluate(() => window.batch.calls), 1);
    await p.evaluate(() => window.batch.resolve({ ok: false, message: "Synthetic unavailable" }));
    await b.waitFor({ state: "visible" });
    await p.waitForFunction(() => !document.querySelector('[aria-label="Refresh queue"]').disabled);
    await b.focus();
    await p.keyboard.press("Space");
    await p.waitForFunction(() => window.batch.calls === 2);
    await p.evaluate(() => window.batch.resolve({ ok: true }));
    assert.equal(await p.evaluate(() => window.batch.commands), 0);
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  });
  if (!process.env.QA_CASE || process.env.QA_CASE === "search") for (const width of [375, 1440]) await check("GEN-04 queue shared search geometry and filtering " + width, async () => {
    await p.setViewportSize({ width, height: 1e3 });
    const input = p.getByRole("searchbox", { name: "Find patient or queue number", exact: true });
    await input.waitFor();
    assert.equal(await p.locator(".enc-filters .search-input-icon").count(), 1);
    const geometry = await input.evaluate((e) => {
      const i = e.parentElement.querySelector("svg"), a = e.getBoundingClientRect(), b = i.getBoundingClientRect();
      return { padding: parseFloat(getComputedStyle(e).paddingLeft), right: b.right - a.left, height: a.height };
    });
    assert.ok(geometry.padding > geometry.right, JSON.stringify(geometry));
    assert.ok(geometry.height >= 44);
    await input.focus();
    assert.ok(await input.evaluate(e => getComputedStyle(e).outlineStyle !== "none"), "search retains its focus indicator");
    await input.fill("no such patient");
    await p.getByText("No patients match this search.", { exact: true }).waitFor();
    await input.fill("Synthetic queue");
    assert.equal(await p.locator(".enc-queue-row").count(), 1);
    assert.equal(await p.evaluate(() => window.batch.commands), 0);
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  });
  if (!process.env.QA_CASE || process.env.QA_CASE === "sharedSearch") await check("GEN-04 shared SearchInput inside Field keeps text clear of icon", async () => {
    await p.evaluate(() => window.batch.mode("sharedSearch"));
    const input = p.getByRole("searchbox", { name: "Shared search test", exact: true });
    await input.waitFor();
    const geometry = await input.evaluate((e) => ({ padding: parseFloat(getComputedStyle(e).paddingLeft), right: e.parentElement.querySelector("svg").getBoundingClientRect().right - e.getBoundingClientRect().left }));
    assert.ok(geometry.padding > geometry.right, JSON.stringify(geometry));
    await input.focus();
    assert.ok(await input.evaluate(e => getComputedStyle(e).outlineStyle !== "none"), "shared search retains its focus indicator");
  });
  for (const kind of ["searchClearFocus", "searchClearTarget"]) if (!process.env.QA_CASE || process.env.QA_CASE === kind) for (const width of [375,1440]) await check("GEN-02/GEN-12 shared search clear: "+kind+" at "+width,async()=>{
    await p.setViewportSize({width,height:1000});await p.evaluate(()=>window.batch.mode("searchClear"));const input=p.getByRole("searchbox",{name:"Shared clear test",exact:true});await input.fill("Illustrative query");const clear=p.getByRole("button",{name:"Clear search",exact:true});
    if(kind==="searchClearTarget"){const size=await clear.boundingBox();assert.ok(size.width>=44&&size.height>=44,JSON.stringify(size));const spacing=await input.evaluate(e=>({padding:parseFloat(getComputedStyle(e).paddingRight),button:e.parentElement.querySelector('button').getBoundingClientRect().width}));assert.ok(spacing.padding>spacing.button,JSON.stringify(spacing));}
    else for(const key of ["Enter","Space"]){await clear.focus();await p.keyboard.press(key);assert.equal(await input.inputValue(),"");assert.equal(await input.evaluate(e=>e===document.activeElement),true,"focus survives conditional clear removal");assert.equal(await p.evaluate(()=>window.batch.searchMatchesRef()),true,"external input ref remains valid");await input.fill("Next query");}
  });
  if (!process.env.QA_CASE || process.env.QA_CASE === "encounter") await check("GEN-13 unavailable encounter icon and read-only refresh", async () => {
    await p.evaluate(() => window.batch.mode("encounter"));
    const b = p.getByRole("button", { name: "Refresh encounter", exact: true });
    await b.waitFor();
    assert.equal(await b.textContent(), "");
    await b.click();
    assert.equal(await b.getAttribute("aria-busy"), "true");
    await p.evaluate(() => window.batch.resolve({ ok: false }));
    assert.equal(await p.evaluate(() => window.batch.commands), 0);
    assert.equal(await p.getByRole("heading", { name: "Encounter unavailable" }).count(), 1);
  });
  if (!process.env.QA_CASE || process.env.QA_CASE === "calendar") for (const width of [375, 768, 1440]) await check("OWN-08 past/today/future, markers, history and boundaries " + width, async () => {
    await p.setViewportSize({ width, height: 1e3 });
    await p.evaluate(() => window.batch.mode("calendar"));
    const past = p.locator('[data-date="2026-11-11"]'), today = p.locator('[data-date="2026-11-12"]'), future = p.locator('[data-date="2026-11-13"]');
    await today.waitFor();
    assert.match(await past.getAttribute("class"), /is-past/);
    assert.doesNotMatch(await future.getAttribute("class"), /is-past/);
    assert.equal(await today.getAttribute("aria-current"), "date");
    assert.equal(await past.isEnabled(), true);
    const color = (loc) => loc.evaluate((e) => getComputedStyle(e).color);
    assert.notEqual(await color(past), await color(future));
    await past.click();
    await p.waitForFunction(() => document.querySelector('[data-date="2026-11-11"]').getAttribute("aria-pressed") === "true");
    assert.equal(await past.locator("i").count(), 1);
    await past.focus();
    await p.keyboard.press("ArrowRight");
    assert.equal(await today.getAttribute("aria-pressed"), "true");
    assert.equal(await today.evaluate((e) => e === document.activeElement), true);
    await p.evaluate(() => window.batch.date("2026-12-31"));
    await p.locator('[data-date="2026-12-31"]').waitFor();
    assert.doesNotMatch(await p.locator('[data-date="2027-01-01"]').getAttribute("class"), /is-past/);
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  });
  if (!process.env.QA_CASE || process.env.QA_CASE === "preview") await check("GEN-13 clean preview uses loading icon; editing retains Preview my changes", async () => {
    await p.evaluate(() => window.batch.mode("preview"));
    await p.waitForFunction(() => window.batch.calls === 1);
    await p.locator(".au-tpl-edit .au-actions button").first().waitFor();
    assert.equal(await p.locator(".au-tpl-edit .au-actions button").first().textContent(), "");
    const b = p.getByRole("button", { name: "Refresh preview", exact: true });
    await b.waitFor();
    assert.equal(await b.textContent(), "");
    assert.equal(await b.isDisabled(), true);
    await p.evaluate(() => window.batch.resolve({ ok: true, data: { subject: "Synthetic subject", html: "<p>Synthetic preview</p>" } }));
    await p.waitForFunction(() => !document.querySelector('[aria-label="Refresh preview"]').disabled);
    await b.click();
    assert.equal(await b.getAttribute("aria-busy"), "true");
    await p.evaluate(() => window.batch.resolve({ ok: false, message: "Synthetic preview unavailable" }));
    await p.getByRole("alert").waitFor();
    await p.getByRole("textbox", { name: "Subject", exact: true }).fill("Changed subject");
    await p.getByRole("button", { name: "Preview my changes", exact: true }).waitFor();
    assert.equal(await p.getByRole("button", { name: "Refresh preview", exact: true }).count(), 0);
  });
  if (!process.env.QA_CASE || process.env.QA_CASE === "duty") await check("GEN-13 Staff duty loading icon and readback", async () => {
    await p.evaluate(() => window.batch.mode("duty"));
    await p.waitForFunction(() => window.batch.calls === 1);
    await p.locator(".stf07-duty button").waitFor();
    assert.equal(await p.locator(".stf07-duty button").textContent(), "");
    const b = p.getByRole("button", { name: "Refresh duty status", exact: true });
    await b.waitFor();
    assert.equal(await b.textContent(), "");
    assert.equal(await b.isDisabled(), true);
    await p.evaluate(() => window.batch.resolve({ ok: true, data: { duty: { date: "2026-11-01", rows: [] } } }));
    await p.waitForFunction(() => !document.querySelector('[aria-label="Refresh duty status"]').disabled);
    await b.click();
    assert.equal(await b.getAttribute("aria-busy"), "true");
    await p.evaluate(() => window.batch.resolve({ ok: false, message: "Synthetic unavailable" }));
    await p.getByText("Synthetic unavailable", { exact: true }).waitFor();
    assert.equal(await p.evaluate(() => window.batch.calls), 2);
  });
  console.log(JSON.stringify({ passed: completed.length, completed }));
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
