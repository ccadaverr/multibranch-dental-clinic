import {readOwnedArchive} from './archive-readback.js'
import {boundedClinicalRead} from '../clinical-history.js'
const text=v=>typeof v==='string'&&!!v.trim()
const time=v=>text(v)&&Number.isFinite(Date.parse(v))
const optional=v=>v==null||typeof v==='string'
const fail=message=>({ok:false,message})
const mimes=['application/pdf','image/jpeg','image/png','image/webp']
export function verifiedDocument(d,patientId,{retracted=false}={}) {
 return !!d&&text(d.id)&&d.patient?.id===patientId&&text(d.patient.name)&&text(d.patient.code)&&
  (retracted?d.status==='Retracted':['Active','Archived'].includes(d.status))&&
  text(d.original_filename)&&optional(d.title)&&text(d.category)&&mimes.includes(d.mime_type)&&
  Number.isSafeInteger(d.file_size_bytes)&&d.file_size_bytes>0&&d.file_size_bytes<=10485760&&
  /^[a-f0-9]{64}$/.test(d.checksum_sha256)&&time(d.created_at)&&optional(d.visit_id)&&
  (d.branch==null||text(d.branch.id)&&text(d.branch.name))&&
  (d.uploaded_by==null||['patient','staff','dentist'].includes(d.uploaded_by.role))
}
export function readPatientDocuments(read,patientId,owns,timeout=30000) {
 return readOwnedArchive(async guard=>{
  if(!text(patientId))return fail('Your Patient identity is unavailable.')
  const rows=[],seen=new Set();let cursor=null,pages=0
  do{
   if(++pages>1000)return fail('The document library is too large to read here. Contact the clinic.')
   const r=await guard(read)({per_page:100,...(cursor?{cursor}:{})})
   if(!r.ok)return r
   if(r.meta?.patient_id!==patientId||!Object.hasOwn(r.meta,'next_cursor')||new Set(r.data.map(d=>d?.id)).size!==r.data.length||r.data.some(d=>!verifiedDocument(d,patientId)||seen.has(d.id)))return fail('The documents did not confirm your Patient identity. Reload to try again.')
   for(const d of r.data){seen.add(d.id);rows.push(d)}
   cursor=r.meta.next_cursor
   if(cursor!==null&&(!text(cursor)||cursor!==r.data.at(-1)?.id))return fail('Document pages could not be verified. Reload to try again.')
  }while(cursor)
  return {ok:true,data:rows}
 },owns,timeout)
}
export function readPatientConsents(read,patientId,owns,timeout=30000) {
 return readOwnedArchive(async guard=>{
  const r=await guard(read)()
  if(!r.ok)return r
  if(!text(patientId)||new Set(r.data.map(c=>c?.id)).size!==r.data.length||r.data.some(c=>!text(c?.id)||c.patient_id!==patientId||!['Granted','Withdrawn'].includes(c.status)||!text(c.consent_type)||!text(c.version)||!time(c.signed_at)||!optional(c.notes)||!optional(c.document_id)||c.status==='Withdrawn'&&!time(c.withdrawn_at)))return fail('The consent records did not confirm your Patient identity. Reload to try again.')
  return r
 },owns,timeout)
}
export async function fileSha256(file) {
 const bytes=await file.arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',bytes)
 return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('')
}
/** One immutable in-memory file/description/key per intent; no document bytes in browser storage. */
export function documentUploadIntent({file,title,category,checksum,patientId,key,owns}) {
 let pending=false,done=false
 return {async run(upload,timeout=30000){
  if(pending||done)return {ok:false,duplicate:true}
  if(!owns())return {ok:false,obsolete:true}
  pending=true
  try{
   const body=new FormData();body.append('file',file);body.append('category',category);if(title)body.append('title',title)
   const r=await boundedClinicalRead(()=>upload(body,key,owns),timeout)
   if(!owns())return {ok:false,obsolete:true}
   if(r.ok&&verifiedDocument(r.data,patientId)&&r.data.checksum_sha256===checksum&&r.data.category===category&&r.data.file_size_bytes===file.size&&(!title||r.data.title===title)){done=true;return {...r,verified:true}}
   if(!r.ok&&['validation','forbidden','unauthenticated','not_found'].includes(r.kind))return {...r,refused:true}
   return fail('The upload result is unconfirmed. Keep this window open and retry the same upload.')
  }finally{pending=false}
 }}
}
