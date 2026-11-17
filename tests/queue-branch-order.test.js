import test from 'node:test'
import assert from 'node:assert/strict'
import {compareBranchQueue, mapQueueEntry} from '../src/queue-api.js'

test('branch order follows server position across Dentist names, booking types and local queue numbers', () => {
  const rows=[
    {id:'late',branchId:'b1',dentistName:'A Dentist',queueNumber:1,position:1,branchPosition:3,walkIn:false},
    {id:'walkin',branchId:'b1',dentistName:'Z Dentist',queueNumber:8,position:2,branchPosition:1,walkIn:true},
    {id:'scheduled',branchId:'b1',dentistName:'B Dentist',queueNumber:1,position:1,branchPosition:2},
    {id:'served',branchId:'b1',branchPosition:null,position:null},
    {id:'other',branchId:'b2',branchPosition:1,position:1},
  ]
  assert.deepEqual(rows.sort(compareBranchQueue).map(r=>r.id),['walkin','scheduled','late','served','other'])
})

test('queue mapping preserves additive branch position and the offset-bearing arrival fact', () => {
  const row=mapQueueEntry({id:'entry',branch_position:4,position:2,visit:{arrived_at:'2026-11-17T00:00:01+08:00',source:'walk_in'}})
  assert.equal(row.branchPosition,4)
  assert.equal(row.position,2)
  assert.equal(row.arrivedAt,'2026-11-17T00:00:01+08:00')
  assert.equal(mapQueueEntry({id:'dentist'}).branchPosition,null)
})
