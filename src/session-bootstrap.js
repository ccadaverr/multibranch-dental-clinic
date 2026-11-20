// Bounds real startup I/O; successful responses return immediately, without a minimum splash duration.
export async function bootstrapSession(readSession, {setTimer=setTimeout,clearTimer=clearTimeout}={}) {
  const controller=new AbortController()
  let timer
  const timeout=new Promise(resolve=>{
    timer=setTimer(()=>{controller.abort();resolve({ok:false,kind:'network'})},30000)
  })
  // Also bound adapters that fail to settle after abort, and normalize unexpected rejection.
  try {return await Promise.race([readSession({signal:controller.signal}),timeout])}
  catch {return {ok:false,kind:'network'}}
  finally {clearTimer(timer)}
}
