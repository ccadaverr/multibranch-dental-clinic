import test from 'node:test'
import assert from 'node:assert/strict'
import { appointmentActionProblem, canSchedule, schedulingActorKey } from '../src/appointment-ui.js'
import { clinicDate } from '../src/clock.js'

function fixture() {
  return {
    session: { serverUserId:'server-staff', userId:'staff', role:'staff', active:true, branchId:'b1', branchScopes:['b1'] },
    state: { users:[{id:'staff',personId:'person',role:'Staff',status:'Active',branchId:'b1',permissions:['appointments']}],
      persons:[{id:'person'}],staff:[{userId:'staff',personId:'person',branchId:'b1'}],appointments:[] },
  }
}
const appointment=()=>({id:'A',revision:3,status:'Confirmed',date:clinicDate(),branchId:'b1',patientPublicId:'patient-A',serviceId:'s1',dentistId:'d1'})

test('FE-INT-P1 scheduling actor key canonicalizes branch scope and permission ordering',()=>{
  const store=fixture();store.session.branchScopes=['b1','b2'];store.state.users[0].permissions=['appointments','messages']
  const key=schedulingActorKey(store)
  store.session.branchScopes=['b2','b1','b1'];store.state.users[0].permissions=['messages','appointments','appointments']
  assert.equal(schedulingActorKey(store),key)
})
test('FE-INT-P1 scheduling actor key changes for authentication lifetime, permissions and profile revocation',()=>{
  for(const mutate of [s=>{s.getAuthGeneration=()=>2},s=>{s.session.serverUserId='replacement'},s=>{s.session.branchScopes=[]},s=>{s.state.users[0].permissions=[]},s=>{s.state.staff=[]},s=>{s.state.persons=[]}]){
    const store=fixture(),before=schedulingActorKey(store);mutate(store)
    assert.notEqual(schedulingActorKey(store),before)
  }
})
test('FE-INT-P1 scheduling controls require current identity, existing permission and authorized branch',()=>{
  const store=fixture()
  assert.equal(canSchedule(store,'b1'),true)
  assert.equal(canSchedule(store,'b2'),false)
  store.session.branchScopes=[];assert.equal(canSchedule(store,'b1'),false)
  store.session.branchScopes=['b1'];store.state.users[0].permissions=[];assert.equal(canSchedule(store,'b1'),false)
  store.state.users[0].permissions=['appointments'];store.state.persons=[];assert.equal(canSchedule(store,'b1'),false)
  assert.equal(canSchedule({session:store.session,state:{}}),false)
})
test('FE-INT-P1 Owner administrative scheduling exception retains explicit branch scope',()=>{
  const store=fixture();store.session.role='owner';store.state.users[0].role='Owner / Admin';store.state.users[0].permissions=['all']
  assert.equal(canSchedule(store,'b2'),true)
  const key=schedulingActorKey(store);store.session.branchScopes=['b2']
  assert.equal(schedulingActorKey(store),key,'Staff branch scopes do not redefine Owner access')
  store.session.scopeBranchId='b1';assert.equal(canSchedule(store,'b2'),false)
})
test('FE-INT-P1 stale appointment revisions and canonical link changes are rejected without rebasing',()=>{
  for(const patch of [{revision:4},{patientPublicId:'other'},{branchId:'b2'},{serviceId:'s2'},{dentistId:'d2'}]){
    const store=fixture(),opened=appointment();store.state.appointments=[{...opened,...patch}]
    assert.match(appointmentActionProblem(store,opened),/changed/)
    assert.equal(opened.revision,3)
  }
})
test('FE-INT-P1 admitted and terminal appointments cannot acquire pre-arrival controls',()=>{
  for(const status of ['Checked In','In Treatment','Completed','Cancelled','No-show']){
    assert.match(appointmentActionProblem(fixture(),{...appointment(),status}),/can no longer/)
  }
})
test('FE-INT-P1 no-show remains an explicit same-day action',()=>{
  assert.equal(appointmentActionProblem(fixture(),appointment(),'noShow'),'')
  assert.match(appointmentActionProblem(fixture(),{...appointment(),date:'2020-01-01'},'noShow'),/today/)
})
test('FE-INT-P1 a fresh calendar detail is usable when the wider store window is absent or older',()=>{
  const store=fixture(),fresh=appointment()
  assert.equal(appointmentActionProblem(store,fresh),'')
  store.state.appointments=[{...fresh,revision:1}]
  assert.equal(appointmentActionProblem(store,fresh),'')
})
