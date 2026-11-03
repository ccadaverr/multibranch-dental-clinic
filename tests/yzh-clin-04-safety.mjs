// Replay every historical CLIN-03 assertion, adapting only the intentionally
// corrected segmented-control role. The historical file stays byte-for-byte intact.
import {readFile} from 'node:fs/promises'
const original = await readFile(new URL('./yzh-clin-03.browser.mjs', import.meta.url), 'utf8')
let replay = original
  .replaceAll("getByRole('tab',", "getByRole('button',")
  .replace("'./playwright-odontogram-motion.js'", JSON.stringify(new URL('./playwright-odontogram-motion.js', import.meta.url).href))
  .replace("from 'playwright'", 'from ' + JSON.stringify(import.meta.resolve('playwright')))
if (process.env.CLIN04_SELECTION === 'chooser') {
  const inheritedPick = "async function pick(p,id){await tooth(p,id).click();await discard(p)}"
  if (!replay.includes(inheritedPick)) throw new Error('Historical selection helper changed; review replay adapter')
  replay = replay.replace(inheritedPick, "async function pick(p,id){await p.getByRole('combobox',{name:'Choose tooth',exact:true}).selectOption(id);await discard(p)}")
}
try { await import('data:text/javascript;base64,' + Buffer.from(replay).toString('base64')) }
catch (error) { console.error(error.message); process.exitCode = 1 }
