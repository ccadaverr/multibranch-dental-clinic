import {createRequire} from 'node:module'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {dirname, resolve} from 'node:path'

const root=resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtime=process.argv[2], require=createRequire(root+'/package.json')
const port=Number(process.argv[3]||5195)
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Use an unprivileged loopback Vite port.')
const {createServer}=await import(pathToFileURL(require.resolve('vite')))
const plugin=await import(pathToFileURL(require.resolve('@vitejs/plugin-react')))
const server=await createServer({
  configFile:false, root, envDir:runtime+'/env', cacheDir:runtime+'/cache/vite',
  plugins:[(plugin.default?.default||plugin.default)()],
  server:{host:'127.0.0.1',port,strictPort:true,open:false},
})
await server.listen()
server.printUrls()
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{await server.close();process.exit(0)})
