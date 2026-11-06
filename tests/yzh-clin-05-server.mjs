// Read production source through an isolated Temp root; dependencies are reused read-only.
import {mkdtemp, realpath, symlink} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {execFileSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'
import path from 'node:path'
import os from 'node:os'

const root = process.cwd(), dependencies = process.env.CLIN05_NODE_MODULES
if (!dependencies || !path.isAbsolute(dependencies)) throw new Error('Set CLIN05_NODE_MODULES to an existing verified dependency directory.')
const require = createRequire(path.join(dependencies, '..', 'package.json'))
const {createServer} = await import(pathToFileURL(path.join(dependencies, 'vite/dist/node/index.js')))
const {default: react} = await import(pathToFileURL(require.resolve('@vitejs/plugin-react')))
const runtime = await mkdtemp(path.join(await realpath(os.tmpdir()), 'yzh-clin05-runtime-'))
for (const [name, target] of [['src', path.join(root, 'src')], ['tests', path.join(root, 'tests')], ['node_modules', dependencies]]) {
  await symlink(target, path.join(runtime, name), 'junction')
}
const baseline = process.argv.includes('--baseline'), port = Number(process.env.CLIN05_PORT || 5196)
const server = await createServer({
  root: runtime, configFile: false, cacheDir: path.join(runtime, 'cache'),
  resolve: {preserveSymlinks: true},
  plugins: [{name: 'clin05-immutable-baseline', enforce: 'pre', load(id) {
    if (baseline && id.split('?')[0].replaceAll('\\', '/').endsWith('/src/pages/ServerPrescriptions.jsx')) {
      return execFileSync('git', ['show', 'b0df61212df12126d1f22d97a32af803b8bc1558:src/pages/ServerPrescriptions.jsx'], {cwd: root, encoding: 'utf8'})
    }
  }}, react()],
  server: {host: '127.0.0.1', port, strictPort: true, fs: {allow: [runtime, root, dependencies]}},
})
await server.listen()
console.log(JSON.stringify({ready: true, port, baseline, runtime}))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {await server.close(); process.exit(0)})
