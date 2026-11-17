import test from 'node:test'
import assert from 'node:assert/strict'
import { exactPeso, pesoCentavos, validateRevenueReport, weeklyChartAvailable } from '../src/owner-revenue-data.js'
import * as api from '../src/api-client.js'
import { fetchDailyRevenue, fetchWeeklyRevenueHistogram } from '../src/analytics-api.js'

const report = () => ({ timezone:'Asia/Manila', week_start_date:'2026-10-26', week_end_date:'2026-10-31', is_finalized:false,
  totals:{gross_collected_php:'0.30',refunded_php:'0.05',net_cash_flow_php:'0.25',payments_count:2,refunds_count:1},
  buckets:Array.from({length:6},(_,i)=>({date:`2026-10-${26+i}`,day_of_week:i+1,gross_collected_php:i===0?'0.10':i===1?'0.20':'0.00',
    refunded_php:i===2?'0.05':'0.00',net_cash_flow_php:i===0?'0.10':i===1?'0.20':i===2?'-0.05':'0.00',payments_count:i<2?1:0,refunds_count:i===2?1:0})) })

test('peso display preserves centavos and large decimal amounts without Number rounding', () => {
  assert.equal(exactPeso('90071992547409.93'), '₱90,071,992,547,409.93')
  assert.equal(exactPeso('-750.25'), '-₱750.25')
  assert.equal(pesoCentavos('0.10') + pesoCentavos('0.20'), 30n)
  for (const value of [null, '', 'bad', '1.234', 1.23]) assert.throws(() => exactPeso(value))
})

test('server daily/weekly projections reconcile exact collections, refunds and negative net days', () => {
  const value = report()
  assert.equal(validateRevenueReport(value,true), value)
  assert.equal(validateRevenueReport({...value,days:value.buckets}).totals.net_cash_flow_php,'0.25')
})

test('malformed or non-reconciling revenue projections fail instead of becoming zero', () => {
  const changed = report(); changed.buckets[0].gross_collected_php='1.00'
  assert.throws(() => validateRevenueReport(changed,true))
  const wrong = report(); wrong.totals.net_cash_flow_php='0.26'
  assert.throws(() => validateRevenueReport(wrong,true))
  assert.throws(() => validateRevenueReport({...report(),buckets:[]},true))
  assert.throws(() => validateRevenueReport({...report(),timezone:'UTC'},true))
})

test('a reconciled report must cover every day of the requested Manila range', () => {
  const value = report()
  const daily = { ...value, days: value.buckets }
  const range = { date_from: '2026-10-26', date_to: '2026-10-31' }
  assert.throws(() => validateRevenueReport(daily, false, { ...range, date_from: '2026-10-25' }))
  assert.throws(() => validateRevenueReport({ ...daily, days: daily.days.filter(row => row.date !== '2026-10-29') }, false, range))
  assert.equal(validateRevenueReport(daily, false, range), daily)
})

test('weekly readback must match the requested Manila week, including a Sunday reference', () => {
  const value = report()
  assert.throws(() => validateRevenueReport(value, true, { date: '2026-11-02' }))
  assert.equal(validateRevenueReport(value, true, { date: '2026-11-01' }), value)
  value.buckets[3].date = '2026-11-05'
  value.buckets[4].date = '2026-11-06'
  value.buckets[5].date = value.week_end_date = '2026-11-07'
  assert.throws(() => validateRevenueReport(value, true))
})

test('chart projection reconciles the backend two-partial-refund acceptance vector without double-counting collections', () => {
  const data=report()
  data.buckets=data.buckets.map(row=>({...row,gross_collected_php:'0.00',refunded_php:'0.00',net_cash_flow_php:'0.00',payments_count:0,refunds_count:0}))
  Object.assign(data.buckets[0],{gross_collected_php:'6000.00',refunded_php:'500.00',net_cash_flow_php:'5500.00',payments_count:2,refunds_count:1})
  Object.assign(data.buckets[2],{refunded_php:'750.25',net_cash_flow_php:'-750.25',refunds_count:1})
  data.totals={gross_collected_php:'6000.00',refunded_php:'1250.25',net_cash_flow_php:'4749.75',payments_count:2,refunds_count:2}
  assert.equal(validateRevenueReport(data,true),data)
  assert.equal(exactPeso(data.totals.net_cash_flow_php),'₱4,749.75')
  assert.equal(exactPeso(data.buckets[2].net_cash_flow_php),'-₱750.25')
})

test('Saturday is visible in progress, pre-Saturday requires preview, historical finalization remains authoritative', () => {
  const value=report()
  assert.equal(weeklyChartAvailable(value,'2026-10-29'), false)
  assert.equal(weeklyChartAvailable(value,'2026-10-29',true), true)
  assert.equal(weeklyChartAvailable(value,'2026-10-31'), true)
  assert.equal(value.is_finalized,false)
  assert.equal(weeklyChartAvailable({...value,is_finalized:true},'2026-11-01'),true)
})

test('existing API helpers preserve decimal payloads and encode current branch, period and historical week date', async () => {
  const previous=globalThis.fetch
  const calls=[]
  try {
    api.__resetCsrfCacheForTests()
    globalThis.fetch=async url=>{calls.push(new URL(url,'http://localhost'));return {ok:true,status:200,json:async()=>({data:report()})}}
    const daily=await fetchDailyRevenue({period:'this month',branch_id:'public-branch'})
    assert.equal(daily.totals.gross_collected_php,'0.30')
    assert.equal(calls[0].searchParams.get('period'),'this month')
    assert.equal(calls[0].searchParams.get('branch_id'),'public-branch')
    await fetchWeeklyRevenueHistogram({date:'2026-10-26',branch_id:'public-branch'})
    assert.equal(calls[1].searchParams.get('date'),'2026-10-26')
    assert.equal(calls[1].searchParams.get('branch_id'),'public-branch')
  } finally {globalThis.fetch=previous}
})
