import React, { useEffect, useState } from 'react'
import { myChart } from '../../api-client.js'
import { Odontogram } from '../../components/odontogram/index.js'
import { RefreshButton } from '../../components.jsx'
import { patientChartMatches } from '../../chart-command.js'
import { EmptyState, ErrorState, PageHead, Skeleton } from '../ui.jsx'

/** Patient's own current chart: authorized simplified read only, without clinical notes or history. */
export function TeethPage({session,getAuthGeneration}) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [picked, setPicked] = useState(null), [attempt, setAttempt] = useState(0)
  const generation=getAuthGeneration?.(),owner=JSON.stringify([session?.serverUserId,session?.patientPublicId,generation])
  const latest=React.useRef(owner);latest.current=owner
  useEffect(() => {
    let current=true,timer
    const owns=()=>current&&latest.current===owner&&session?.role==='patient'&&session?.active===true&&(!getAuthGeneration||generation!=null&&generation===getAuthGeneration())
    setError('');setData(null);setPicked(null)
    if(!owns()){setError('Your Patient chart session is unavailable. Sign in again.');return}
    Promise.race([myChart(),new Promise(resolve=>{timer=setTimeout(()=>resolve({ok:false,message:'The chart read timed out. Retry to read the saved findings.'}),30000)})]).then(r=>{
      if(!owns())return
      if(r.ok&&patientChartMatches(r.data,session.patientPublicId))setData(r.data)
      else setError(r.message||'The returned chart did not confirm your Patient identity. No findings were adopted.')
    }).catch(()=>{if(owns())setError('Your chart could not be loaded. Retry to read the saved findings.')}).finally(()=>clearTimeout(timer))
    return()=>{current=false;clearTimeout(timer)}
  }, [attempt,owner])
  return <div className="pp-page pp-fade">
    <PageHead eyebrow="Records & Billing" title="My teeth" text="What your dentist recorded for each tooth. Ask your dentist if you have a question; this chart is not medical advice." actions={<RefreshButton title="Reload my chart" ariaLabel="Reload my chart" onClick={()=>setAttempt(a=>a+1)}/>}/>
    {error && <ErrorState text={error} onRetry={() => setAttempt(a => a + 1)}/>}
    {!data && !error && <Skeleton lines={4} label="Loading your dental chart"/>}
    {data && !data.current.length && <EmptyState icon="star" title="Nothing recorded yet" text="When your dentist records findings on your dental chart during a visit, they will appear here."/>}
    {data && data.current.length > 0 && <section className="pp-card">
      <Odontogram data={data} selected={picked} onSelect={setPicked} canRecord={false}/>
    </section>}
  </div>
}
