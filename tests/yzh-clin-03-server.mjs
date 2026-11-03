import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
import {execFileSync} from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
const baseline=process.argv.includes('--baseline'),port=Number(process.env.CLIN03_PORT||5188)
const sources=['src/components/odontogram/Odontogram.jsx','src/components/odontogram/ToothTimeline.jsx','src/pages/DentalChart.jsx']
const server=await createServer({configFile:false,plugins:[{name:'clinical-baseline-replay',enforce:'pre',load(id){const file=path.relative(process.cwd(),id.split('?')[0]).replaceAll('\\','/');if(baseline&&sources.includes(file))return execFileSync('git',['show','a6a0de5bf36c77a43d948b98f821940bac41df3d:'+file],{encoding:'utf8'})}},react()],cacheDir:path.join(os.tmpdir(),'yzh-clin-03-vite-'+port),server:{host:'127.0.0.1',port,strictPort:true}})
await server.listen()
console.log('CLIN03_SERVER_READY '+port+(baseline?' baseline':' working source'))
