import {createRequire} from 'node:module'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {dirname, resolve} from 'node:path'

const root=resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtime=process.argv[2], require=createRequire(root+'/package.json')
const {createServer}=await import(pathToFileURL(require.resolve('vite')))
const plugin=await import(pathToFileURL(require.resolve('@vitejs/plugin-react')))
const server=await createServer({
  configFile:false, root, envDir:runtime+'/env', cacheDir:runtime+'/cache/vite',
  plugins:[(plugin.default?.default||plugin.default)()],
  server:{host:'127.0.0.1',port:5195,strictPort:true,open:false},
})
await server.listen()
server.printUrls()
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{await server.close();process.exit(0)})
