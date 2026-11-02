import { dentistFixture, today } from './den-ui-01-fixture.js'
export { today }
export function clinicalFixture() {
  const {state,session}=dentistFixture()
  state.dentists[0].name='Illustrative Dentist'
  state.services=[{id:'svc1',name:'Illustrative consultation',status:'Active'}]
  state.branchServices=[{branchId:'b1',serviceId:'svc1',active:true}]
  state.dentistServiceAssignments=[{dentistId:'d1',serviceId:'svc1',isAuthorized:true}]
  state.patients=[{id:'p1',patientCode:'TEST-001',name:'Illustrative Patient Alexandra with a long family name',serverProjection:true},{id:'p2',patientCode:'TEST-002',name:'Illustrative Patient Beatriz',serverProjection:true}]
  Object.assign(state,{visits:[],visitsProjected:true,hmo:[],documents:[],consents:[],audit:[],workflowLog:[],invoices:[],staff:[]})
  return {state,session}
}
export function visitRow(id='v1',patient='p1',dentist='d1') {
  return {id,status:'Checked In',revision:1,clinic_date:today,source:'walk_in',arrived_at:today+'T08:45:00+08:00',
    patient:{id:patient,code:patient==='p1'?'TEST-001':'TEST-002',name:patient==='p1'?'Illustrative Patient Alexandra with a long family name':'Illustrative Patient Beatriz'},
    branch:{id:'b1',name:'Illustrative Central Branch'},dentist:{id:dentist,name:'Illustrative Dentist'},service:{id:'svc1',name:'Illustrative consultation'},appointment:null}
}
export function queueRow(id='q1',visit=visitRow()) {return {id,status:'Waiting',revision:1,clinic_date:today,queue_number:id==='q1'?1:2,position:id==='q1'?1:2,priority:'Normal',visit,patient:visit.patient,branch:visit.branch,dentist:visit.dentist,service:visit.service,appointment:null}}
export function treatmentRow(visit=visitRow(),queueId='q1') {
  return {id:'t1',status:'In Treatment',revision:1,clinic_date:today,author:true,visit:{...visit,queue:{id:queueId}},patient:visit.patient,branch:visit.branch,dentist:visit.dentist,appointment:null,requested_service:visit.service,chief_complaint:'',clinical_notes:'',treatment_plan:'',procedure_summary:'',prescription_required:false,followup_required:false,procedures:[]}
}
