import assert from 'node:assert/strict'

export async function runOwnerAnalyticsAcceptance(page, base = 'http://127.0.0.1:5176') {
  let mode = 'normal'
  let hold = false
  let reportingDay
  const pending = []
  const requests = []
  const addDays = (date, days) => { const d=new Date(date+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10) }
  const summary = {period_label:'Synthetic window',financials:{total_collected_php:'0.00',total_gross_php:'0.00',paid_invoices_count:0},scheduling:{total_appointments:0,completed:0,cancelled:0,completion_rate_pct:null},patient_flow:{total_visits:0,served_from_queue:0,current_waiting:0},hmo:{approved:0,approved_amount_php:'0.00',pending:0},automation:{health_rate_pct:null,total_actions:0,failed:0}}
  await page.route('**/api/analytics/**', async route => {
    const url=new URL(route.request().url()); requests.push(url)
    if(url.pathname.endsWith('/executive-summary')) return route.fulfill({status:200,json:{data:summary}})
    if(url.pathname.endsWith('/branch-performance')) return route.fulfill({status:200,json:{data:[]}})
    const branchId=url.searchParams.get('branch_id')
    if(hold && branchId?.endsWith('b01')) await new Promise(resolve=>pending.push(resolve))
    if(mode==='error') return route.fulfill({status:503,json:{message:'Unavailable'}})
    if(mode==='loading') await new Promise(resolve=>setTimeout(resolve,250))
    const today=reportingDay||new URL(page.url()).searchParams.get('today')||'2026-10-31'
    const zero=mode==='empty'
    const gross=zero?'0.00':branchId?.endsWith('b01')?'1000.10':branchId?.endsWith('b02')?'2000.20':'3000.30'
    const refund=zero?'0.00':branchId?.endsWith('b01')?'125.05':branchId?.endsWith('b02')?'25.05':'150.10'
    const net=zero?'0.00':branchId?.endsWith('b01')?'875.05':branchId?.endsWith('b02')?'1975.15':'2850.20'
    const counts={payments_count:zero?0:1,refunds_count:zero?0:2}
    const totals={gross_collected_php:gross,refunded_php:refund,net_cash_flow_php:net,...counts}
    const weekly=url.pathname.endsWith('/weekly-histogram')
    const reference=url.searchParams.get('date')||today
    const weekday=new Date(reference+'T00:00:00Z').getUTCDay()||7
    const monday=addDays(reference,1-weekday), saturday=addDays(monday,5)
    const dates=weekly?Array.from({length:6},(_,i)=>addDays(monday,i)):[today]
    const rows=dates.map((date,i)=>({date,day_of_week:i+1,short_day:['Mon','Tue','Wed','Thu','Fri','Sat'][i],
      gross_collected_php:i===dates.length-1?gross:'0.00',refunded_php:i===dates.length-1?refund:'0.00',net_cash_flow_php:i===dates.length-1?net:'0.00',
      payments_count:i===dates.length-1?counts.payments_count:0,refunds_count:i===dates.length-1?counts.refunds_count:0}))
    const data={timezone:'Asia/Manila',branch:branchId?{public_id:branchId}:null,totals,period_label:'Synthetic daily window',week_label:`${monday} – ${saturday}`,
      week_start_date:monday,week_end_date:saturday,is_finalized:today>saturday,...(weekly?{buckets:rows}:{days:rows})}
    return route.fulfill({status:200,json:{data}})
  })
  const cases=[]
  for(const width of [1440,390]) {
    mode='loading'
    await page.setViewportSize({width,height:1000})
    await page.goto(`${base}/tests/fixtures/owner-analytics.html?today=2026-10-31`)
    await page.getByText('Loading daily revenue…',{exact:true}).waitFor()
    const charts=page.locator('.owner-revenue')
    await charts.getByRole('group',{name:'Daily gross collections line chart',exact:true}).waitFor()
    await charts.getByRole('group',{name:'Monday–Saturday gross collections and net cash flow chart',exact:true}).waitFor()
    assert.ok((await charts.innerText()).includes('Saturday summary — in progress'))
    assert.ok(!(await page.locator('body').innerText()).includes('₱94,500 attributed revenue'),'server report excludes fabricated campaign example')
    const daily=charts.getByRole('group',{name:'Daily gross collections line chart',exact:true})
    await daily.getByRole('button').first().focus()
    await charts.getByRole('tooltip').waitFor()
    assert.ok((await charts.getByRole('tooltip').innerText()).includes('2026-10-31'))
    assert.ok((await charts.getByRole('tooltip').innerText()).includes('₱3,000.30'))
    const weekly=charts.getByRole('group',{name:'Monday–Saturday gross collections and net cash flow chart',exact:true})
    await weekly.getByRole('button').last().hover()
    const tooltips=await charts.getByRole('tooltip').allTextContents()
    assert.ok(tooltips.some(t=>t.includes('2026-10-31')&&t.includes('₱150.10')&&t.includes('₱2,850.20')))
    await charts.locator('summary').first().click()
    assert.ok((await charts.locator('table').first().innerText()).includes('₱3,000.30'))
    await page.getByRole('combobox',{name:'Report period'}).selectOption('This Month')
    await page.waitForFunction(()=>document.querySelector('.owner-revenue [aria-label="Daily gross collections line chart"]'))
    assert.ok(requests.some(u=>u.searchParams.get('period')==='this month'))
    mode='normal'; hold=true
    await page.getByRole('combobox',{name:'Acceptance branch'}).selectOption('Synthetic branch 1')
    await page.waitForTimeout(100)
    assert.ok(!(await charts.innerText()).includes('₱3,000.30'),'old branch amounts clear immediately')
    await page.getByRole('combobox',{name:'Acceptance branch'}).selectOption('Synthetic branch 2')
    await charts.getByText('₱2,000.20',{exact:true}).first().waitFor()
    hold=false; pending.splice(0).forEach(resolve=>resolve())
    await page.waitForTimeout(100)
    assert.ok(!(await charts.locator('.owner-revenue-totals').allTextContents()).join(' ').includes('₱1,000.10'),'late branch-one response cannot replace branch-two totals')
    await page.getByLabel('Week containing date',{exact:true}).fill('2026-10-17')
    await charts.getByText('Week finalized — Saturday has passed.',{exact:true}).waitFor()
    assert.ok(requests.some(u=>u.searchParams.get('date')==='2026-10-17'&&u.searchParams.get('branch_id')?.endsWith('b02')))
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'responsive report has no page horizontal overflow')
    const before=requests.length
    await page.getByRole('combobox',{name:'Acceptance branch'}).selectOption('Unavailable branch')
    await page.getByText('Select an available branch to view revenue.',{exact:true}).waitFor()
    assert.equal(requests.length,before,'unresolved branch does not widen to all branches')
    cases.push(`Owner ${width}: loading, line/bar exact focus/hover tooltip, table, period/date/branch mapping, Saturday/historical status, stale-response isolation, responsive layout`)
  }
  mode='normal'
  await page.goto(`${base}/tests/fixtures/owner-analytics.html?today=2026-10-31`)
  const saturdaySummary = page.getByText(/^Saturday summary .* in progress until the reporting day ends\.$/)
  await saturdaySummary.waitFor()
  reportingDay = '2026-11-01'
  const fetchedWeeks = requests.filter(url => url.pathname.endsWith('/weekly-histogram')).length
  await page.evaluate(async date => {
    const { setClockSource } = await import('/src/clock.js')
    setClockSource(() => new Date(date + 'T00:00:01+08:00'))
  }, reportingDay)
  await page.getByRole('combobox', { name: 'Report period' }).selectOption('This Month')
  await page.getByText(/^Week finalized .* Saturday has passed\.$/).waitFor()
  const weeks = requests.filter(url => url.pathname.endsWith('/weekly-histogram'))
  assert.equal(weeks.length, fetchedWeeks + 1)
  assert.equal(weeks.at(-1).searchParams.get('date'), '2026-10-31')
  reportingDay = undefined
  cases.push('Retained Saturday selection reloads its finalization status on the next Manila day')
  await page.goto(`${base}/tests/fixtures/owner-analytics.html?today=2026-10-29`)
  await page.getByRole('button',{name:'Preview in-progress week'}).waitFor()
  assert.equal(await page.getByRole('group',{name:'Monday–Saturday gross collections and net cash flow chart',exact:true}).count(),0)
  await page.getByRole('button',{name:'Preview in-progress week'}).click()
  await page.getByRole('group',{name:'Monday–Saturday gross collections and net cash flow chart',exact:true}).waitFor()
  assert.ok(!(await page.locator('.owner-revenue').innerText()).includes('Week finalized'))
  for(const state of ['empty','error']) {
    mode=state
    await page.goto(`${base}/tests/fixtures/owner-analytics.html?today=2026-10-31`)
    await page.locator('.owner-revenue').getByText(state==='empty'?'No payments or refunds':'Revenue unavailable',{exact:true}).first().waitFor()
    if(state==='error') {
      assert.equal(await page.locator('.owner-revenue-plot').count(),0)
      mode='normal'; await page.getByRole('button',{name:'Retry revenue'}).first().click()
      await page.getByRole('group',{name:'Daily gross collections line chart',exact:true}).waitFor()
    }
  }
  cases.push('Pre-Saturday opt-in preview, no premature finalization, empty, error and retry states')
  return cases
}
