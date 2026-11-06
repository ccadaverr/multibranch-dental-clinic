// Keep historical QA-02 files/evidence intact. Adapt navigation to explicit
// discard, dependency resolution and isolated output only; retain all assertions.
import {mkdtemp, readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import path from 'node:path'
import os from 'node:os'

const dependencies = process.env.CLIN05_NODE_MODULES
if (!dependencies) throw new Error('CLIN05_NODE_MODULES is required.')
const require = createRequire(path.join(dependencies, '..', 'package.json'))
const r1 = process.argv.includes('--r1'), basic = process.argv.includes('--basic')
const file = basic ? 'yzh-qa-02-prescription.browser.mjs' : r1 ? 'yzh-qa-02-r1.browser.mjs' : 'yzh-qa-02-r2.browser.mjs'
const evidence = await mkdtemp(path.join(os.tmpdir(), 'yzh-clin05-' + (basic ? 'basic-' : r1 ? 'r1-' : 'r2-')))
process.env.QA_EVIDENCE_DIR = evidence
process.env.QA_URL = process.env.CLIN05_URL || 'http://127.0.0.1:5196/tests/fixtures/yzh-qa-02.html'
let replay = await readFile(new URL('./' + file, import.meta.url), 'utf8')
for (const name of ['playwright', 'esbuild']) replay = replay.replaceAll("from '" + name + "'", 'from ' + JSON.stringify(pathToFileURL(name === 'playwright' ? path.join(dependencies, 'playwright/index.mjs') : require.resolve(name)).href))
replay = replay.replaceAll('http://127.0.0.1:5187/tests/fixtures/yzh-qa-02.html', process.env.QA_URL)
if (r1) {
  // Only the seven prescription lifecycle cases belong to this assignment.
  replay = replay.replace('if(preCopy&&name', "if(!['save-success','save-failure','issue-success','issue-failure','cancel-pending-save','void-success','void-failure'].includes(name))continue\n   if(preCopy&&name")
} else if (!basic) {
  const oldEvidence = "const evidence = 'docs/ui-review/yzh-qa-02/r2'"
  if (!replay.includes(oldEvidence)) throw new Error('Review the historical R2 evidence adapter.')
  replay = replay.replace(oldEvidence, 'const evidence = ' + JSON.stringify(evidence))
  let selections = 0
  replay = replay.replace(/await visitSelect\(page\)\.selectOption\('([^']+)'\)/g, (_, id) => {selections++; return `await clin05Visit(page, '${id}')`})
  if (selections !== 5) throw new Error('Review the historical R2 selection adapter: ' + selections)
  replay = `async function clin05Visit(page, id) {
    await page.getByRole('combobox', {name:/^Visit/}).selectOption(id)
    const dialog = page.getByRole('dialog', {name:'Leave this prescription?', exact:true})
    if (await dialog.count()) await dialog.getByRole('button', {name:'Discard changes and continue', exact:true}).click()
  }\n` + replay
}
console.log(JSON.stringify({historical: file, evidence, assertions: 'unchanged'}))
try {await import('data:text/javascript;base64,' + Buffer.from(replay).toString('base64'))}
catch (error) {console.error(error.message); process.exitCode = 1}
