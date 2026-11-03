import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
import {execFileSync} from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const baseline = process.argv.includes('--baseline')
const port = Number(process.env.CLIN04_PORT || 5194)
const sources = ['Odontogram.jsx', 'SurfaceDiagram.jsx', 'ToothTimeline.jsx', 'ChartSummary.jsx', 'odontogram.css'].map(f => 'src/components/odontogram/' + f)
const server = await createServer({configFile: false, plugins: [{
  name: 'clin04-inherited-baseline', enforce: 'pre',
  load(id) {
    const file = path.relative(process.cwd(), id.split('?')[0]).replaceAll('\\', '/')
    if (baseline && sources.includes(file)) return execFileSync('git', ['show', '202e7293ded3a1cf64135a69f4a3f90bf119e67a:' + file], {encoding: 'utf8'})
  },
}, react()], cacheDir: path.join(os.tmpdir(), 'yzh-clin-04-vite-' + port), server: {host: '127.0.0.1', port, strictPort: true}})
await server.listen()
console.log('CLIN04_READY ' + port + (baseline ? ' immutable 202e7293' : ' working source'))
