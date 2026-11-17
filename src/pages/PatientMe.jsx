import React, {useState,useEffect,useRef} from 'react'
import {Button,Field,FilterBar,Modal,Notice,PageHeader,RefreshButton,Status} from '../components.jsx'
import {PageHead,EmptyState,ErrorState,Skeleton} from '../patient/ui.jsx'
import {dateLabel} from '../logic.js'
import {patientContext} from '../patient-view.js'
import {DefinitionList} from '../patient-ui.jsx'
import {loadPatientRecord} from '../patient-records-api.js'
import {commandKey} from '../appointments-api.js'
import {ChangeEmailButton} from './ChangeEmailDialog.jsx'
import {downloadDocumentFile,mapDocument,mapConsent,CONSENT_TYPES,DOCUMENT_CATEGORIES} from '../documents-api.js'
import {myDocuments,myConsents,uploadDocument,retractDocument,getDocument} from '../api-client.js'
import {readPatientDocuments,readPatientConsents,documentUploadIntent,fileSha256,verifiedDocument} from '../patient/document-workflow.js'
import {boundedClinicalRead} from '../clinical-history.js'
import '../patient/document-experience.css'

const NO_ACCOUNT=<Notice tone="warning" title="We couldn’t confirm your account">Reopen your workspace, or ask the clinic to check your account access.</Notice>
export function PatientMePage(props){
 const s=props.store.session
 return <PatientMeBody key={JSON.stringify([s?.serverUserId,s?.patientPublicId,props.store.getAuthGeneration?.()])} {...props}/>
}
function PatientMeBody({store,setPage,documentsOnly=false}){
 const {state,toast=()=>{}}=store,session=store.session,ctx=patientContext(state,session),patientId=session?.patientPublicId
 const generation=store.getAuthGeneration?.(),live=useRef(false),serial=useRef(0),reading=useRef(false),command=useRef(null),flight=useRef(false),downloadFlight=useRef(false)
 const owns=()=>live.current&&session?.active===true&&session?.role==='patient'&&!!session?.serverUserId&&!!patientId&&(!store.getAuthGeneration||generation!=null&&store.getAuthGeneration()===generation)
 const [documents,setDocuments]=useState({loading:true,data:[],error:''}),[agreements,setAgreements]=useState({loading:true,data:[],error:''})
 const [query,setQuery]=useState(''),[category,setCategory]=useState('all'),[note,setNote]=useState(''),[downloading,setDownloading]=useState('')
 const [uploadOpen,setUploadOpen]=useState(false),[fileToUpload,setFileToUpload]=useState(null),[uploadTitle,setUploadTitle]=useState(''),[uploadCategory,setUploadCategory]=useState('valid_id'),[uploading,setUploading]=useState(false),[uncertain,setUncertain]=useState(false),[uploadError,setUploadError]=useState('')
 const [retractTarget,setRetractTarget]=useState(null),[retractReason,setRetractReason]=useState(''),[retracting,setRetracting]=useState(false),[retractError,setRetractError]=useState(''),[retractUncertain,setRetractUncertain]=useState(false)
 const uploadButton=useRef(null),retractIntent=useRef(null)
 const reload=async()=>{
  if(reading.current)return
  reading.current=true;const ticket=++serial.current
  setDocuments({loading:true,data:[],error:''});setAgreements({loading:true,data:[],error:''})
  const valid=()=>owns()&&ticket===serial.current
  const adopt=(setter,r,map)=>{if(valid())setter(r.ok?{loading:false,data:r.data.map(map),error:''}:{loading:false,data:[],error:r.message||'These records could not be verified. Reload to try again.'})}
  try{await Promise.all([
   readPatientDocuments(myDocuments,patientId,valid).then(r=>adopt(setDocuments,r,mapDocument)),
   readPatientConsents(myConsents,patientId,valid).then(r=>adopt(setAgreements,r,mapConsent)),
  ])}finally{if(ticket===serial.current)reading.current=false}
 }
 useEffect(()=>{live.current=true;reading.current=false;reload();return()=>{live.current=false;serial.current++;reading.current=false}},[])
 useEffect(()=>{const warn=e=>{if(uncertain||uploading||retractUncertain||retracting){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[uncertain,uploading,retractUncertain,retracting])
 const serverProfile=!!(session?.serverUserId&&patientId)
 const [profile,setProfile]=useState({status:serverProfile?'loading':'local',record:null,message:''}),[profileAttempt,setProfileAttempt]=useState(0)
 useEffect(()=>{if(!serverProfile||documentsOnly)return;let current=true;setProfile({status:'loading',record:null,message:''});loadPatientRecord(session.patientPublicId).then(r=>{if(current&&owns())setProfile(r.ok?{status:'ready',record:r.record,message:''}:{status:'error',record:null,message:r.message})});return()=>{current=false}},[serverProfile,patientId,profileAttempt,documentsOnly])
 const docs=documents.data,consents=agreements.data
 const closeUpload=()=>{if(uploading||uncertain)return;setUploadOpen(false);setFileToUpload(null);setUploadTitle('');setUploadError('');command.current=null}
 const handleUpload=async e=>{
  e?.preventDefault();if(flight.current||!owns())return
  if(!command.current&&(!fileToUpload||fileToUpload.size<=0||fileToUpload.size>10485760))return setUploadError('Choose a nonempty PDF, JPG, PNG or WebP file up to 10 MB.')
  if(!command.current&&uploadCategory==='other'&&!uploadTitle.trim())return setUploadError('Please specify a description for this document.')
  flight.current=true;setUploading(true);setUploadError('')
  try{
   if(!command.current){const checksum=await fileSha256(fileToUpload);if(!owns())return;command.current=documentUploadIntent({file:fileToUpload,title:uploadTitle.trim(),category:uploadCategory,checksum,patientId,key:commandKey(),owns})}
   const r=await command.current.run(uploadDocument)
   if(!owns()||r.obsolete)return
   if(r.verified){command.current=null;setUncertain(false);setUploadOpen(false);setFileToUpload(null);setUploadTitle('');setNote('Document saved: '+(r.data.title||r.data.original_filename)+'.');await reload()}
   else if(r.refused){command.current=null;setUncertain(false);setUploadError(Object.values(r.errors||{})[0]?.[0]||r.message||'The upload was refused. Review the file and description.')}
   else if(!r.duplicate){setUncertain(true);setUploadError(r.message||'The upload result is unconfirmed. Retry the same upload.')}
  }catch{if(owns())setUploadError('The file could not be prepared. Keep it selected and try again.')}
  finally{flight.current=false;if(owns())setUploading(false)}
 }
 const handleDownload=async doc=>{
  if(downloadFlight.current||!owns())return
  downloadFlight.current=true;setDownloading(doc.id);let active=true;const readTicket=serial.current
  const r=await boundedClinicalRead(async()=>{try{await downloadDocumentFile(doc.id,doc.originalFilename,{patientId,checksum:doc.checksumSha256,mimeType:doc.mimeType,size:doc.fileSizeBytes,isCurrent:()=>active&&owns()&&readTicket===serial.current});return {ok:true}}catch(error){return {ok:false,message:error.message||'The file could not be downloaded. Try again.'}}})
  active=false;downloadFlight.current=false;if(!owns())return;setDownloading('');if(!r.ok)setNote(r.message||'The file could not be downloaded. Try again.')
 }
 const handleRetract=async()=>{
  if(flight.current||!owns()||!retractTarget||!retractReason.trim())return
  flight.current=true;setRetracting(true);setRetractError('');if(!retractIntent.current)retractIntent.current={id:retractTarget.id,reason:retractReason.trim()};const {id,reason}=retractIntent.current
  try{
   let r=await boundedClinicalRead(()=>retractDocument(id,{reason},undefined,owns))
   if(!owns())return
   if(!r.ok&&r.code==='already_retracted')r=await boundedClinicalRead(()=>getDocument(id))
   if(!owns())return
   if(r.ok&&r.data.id===id&&verifiedDocument(r.data,patientId,{retracted:true})){setNote('Document retracted: '+(r.data.title||r.data.original_filename)+'. The clinic keeps its record.');setRetractTarget(null);setRetractReason('');retractIntent.current=null;setRetractUncertain(false);await reload()}
   else {const refused=!r.ok&&['forbidden','not_found','unauthenticated','validation'].includes(r.kind)&&r.code!=='already_retracted';setRetractUncertain(!refused);if(refused)retractIntent.current=null;setRetractError(r.message||'Retraction could not be verified. Retry this document.')}
  }finally{flight.current=false;if(owns())setRetracting(false)}
 }
 if(!ctx&&!documentsOnly)return NO_ACCOUNT
 const branch=ctx&&state.branches.find(b=>b.id===ctx.patient.preferredBranchId)
 const filtered=docs.filter(d=>(category==='all'||d.category===category)&&[d.title,d.originalFilename,d.patient?.name,d.patient?.code,d.branch?.name].filter(Boolean).join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
 const openDocument=id=>{const el=document.getElementById('patient-doc-'+id);if(el){el.open=true;el.querySelector('summary')?.focus();el.scrollIntoView({block:'center'})}}
 return <div className="pt-page patient-documents">
  {documentsOnly?<PageHead eyebrow="Records & Billing" title="Documents" actions={<RefreshButton title="Reload documents and consents" ariaLabel="Reload documents and consents" loading={documents.loading||agreements.loading} onClick={reload}/>}/>:<PageHeader kicker="Your account" title="Me" text="Your profile, documents and consent records."/>}
  <div className="doc-owner"><span>Patient record</span><strong>{docs[0]?.patient?`${docs[0].patient.name} · ${docs[0].patient.code}`:patientId}</strong>{docs[0]?.patient&&<small>Patient {patientId}</small>}<p>Documents and consents are for your own record. Family document access is not available here.</p></div>
  {note&&<p role="status" className="doc-result">{note}</p>}
    {!documentsOnly && <section className="pt-record" aria-labelledby="pt-me-profile-title">
      <header><div><h2 id="pt-me-profile-title" className="pt-record-title">Profile</h2><p className="pt-record-sub">This information is read-only for now.</p></div></header>
      {serverProfile
        ? profile.status === 'loading' ? <Notice>Loading your profile…</Notice>
        : profile.status === 'error' ? <Notice tone="warning" title="We couldn’t load your profile">{profile.message} <Button size="sm" variant="ghost" onClick={() => setProfileAttempt(profileAttempt + 1)}>Retry</Button></Notice>
        : <DefinitionList items={[
          { label: 'Name', value: profile.record.name },
          { label: 'Email', value: profile.record.email },
          { label: 'Phone', value: profile.record.phone },
          { label: 'Date of birth', value: profile.record.dob ? dateLabel(profile.record.dob) : null },
          { label: 'Preferred branch', value: profile.record.preferredBranch },
        ]}/>
        : <DefinitionList items={[
          { label: 'Name', value: ctx.patient.name },
          { label: 'Email', value: ctx.patient.email },
          { label: 'Phone', value: ctx.patient.phone },
          { label: 'Date of birth', value: ctx.patient.dob ? dateLabel(ctx.patient.dob) : null },
          { label: 'Preferred branch', value: branch?.name },
        ]}/>}
      {serverProfile && profile.status === 'ready' && <div style={{ marginTop: '12px' }}><ChangeEmailButton/></div>}
      <p className="pt-hint">You can change your sign-in email here. Other profile changes will be available once secure, verified changes are supported; contact the clinic if any of them needs to change now.</p>
    </section>}

  <section className="doc-section" aria-labelledby="pt-me-docs-title">
   <div className="doc-section-head"><div><h2 id="pt-me-docs-title">My Documents</h2><p>Files you uploaded and records shared by the clinic.</p></div><Button ref={uploadButton} disabled={!owns()} onClick={()=>{setNote('');setUploadOpen(true)}}>Upload Document</Button></div>
   {documentsOnly&&<FilterBar search={query} onSearchChange={setQuery} searchPlaceholder="Search documents…" filters={[{label:'Document category',value:category,onChange:setCategory,options:[['all','All categories'],...DOCUMENT_CATEGORIES].map(([value,label])=>({value,label}))}]} onClear={query.trim()||category!=='all'?()=>{setQuery('');setCategory('all')}:undefined}/>}
   {documents.loading?<Skeleton lines={3} label="Loading documents"/>:documents.error?<div><h3>Documents unavailable</h3><ErrorState text={documents.error} onRetry={reload}/></div>:!filtered.length?<EmptyState icon="file" title={docs.length?'No matching documents':'No documents on file yet'} text={docs.length?'Change your search or category.':'Upload a document when the clinic asks for one.'}/>:<div className="doc-library">{filtered.map(doc=><details id={'patient-doc-'+doc.id} className="doc-record" key={doc.id}><summary><span><b>{doc.title}</b><small>{DOCUMENT_CATEGORIES.find(([v])=>v===doc.category)?.[1]||doc.category} · {dateLabel(doc.createdAt)}</small></span><Status>{doc.status}</Status></summary><div className="doc-record-body"><dl><div><dt>Patient</dt><dd>{doc.patient.name} · {doc.patient.code}</dd></div><div><dt>File</dt><dd>{doc.originalFilename} · {doc.fileSizeFormatted}</dd></div><div><dt>Source</dt><dd>{doc.uploadedByPatient ? 'Uploaded by you' : 'Shared by clinic'}</dd></div>{doc.branch&&<div><dt>Branch</dt><dd>{doc.branch.name}</dd></div>}{doc.visitId&&<div><dt>Visit</dt><dd>{doc.visitId}</dd></div>}<div><dt>Document ID</dt><dd>{doc.id}</dd></div></dl><div className="doc-actions"><Button variant="soft" disabled={!!downloading} onClick={()=>handleDownload(doc)}>{downloading===doc.id?'Downloading…':'Download'}</Button>{doc.status==='Active'&&doc.uploadedByPatient&&<Button variant="ghost" onClick={()=>{retractIntent.current=null;setRetractUncertain(false);setRetractTarget(doc);setRetractReason('');setRetractError('')}}>Retract</Button>}</div></div></details>)}</div>}
  </section>
  <section className="doc-section" aria-labelledby="pt-me-consents-title"><div className="doc-section-head"><div><h2 id="pt-me-consents-title">Consents & Agreements</h2><p>Recorded decisions, including withdrawn consents. Uploading a form does not grant consent.</p></div></div>
   {agreements.loading?<Skeleton lines={2} label="Loading consents"/>:agreements.error?<div><h3>Consent records unavailable</h3><ErrorState text={agreements.error} onRetry={reload}/></div>:!consents.length?<p className="doc-empty">No consent records on file.</p>:<div className="doc-library">{consents.map(c=><article className="doc-record doc-consent" key={c.id}><header><h3>{CONSENT_TYPES.find(([v])=>v===c.consentType)?.[1]||c.consentType.replace(/_/g,' ')}</h3><Status>{c.status}</Status></header><p>Version {c.version} · Recorded {dateLabel(c.signedAt)}</p>{c.status==='Withdrawn'&&<p>Withdrawn {dateLabel(c.withdrawnAt)}</p>}{c.notes&&<p>{c.notes}</p>}{c.documentId&&(docs.some(d=>d.id===c.documentId)?<Button variant="soft" onClick={()=>{setQuery('');setCategory('all');requestAnimationFrame(()=>openDocument(c.documentId))}}>Review supporting document</Button>:<p className="pp-hint">The supporting document is not in your current library.</p>)}<details><summary>Record details</summary><p>Patient {c.patientId}</p><p>Consent {c.id}</p></details></article>)}</div>}
  </section>
  <Modal open={uploadOpen} onClose={closeUpload} title="Upload Document" subtitle="Files are type-checked but not scanned for malware. They remain available to you and authorized clinic staff.">
   <form onSubmit={handleUpload} className="doc-upload-form"><p>For Patient {patientId}</p>{uploadError&&<p role="alert">{uploadError}</p>}{uncertain&&<Notice tone="warning">Keep this window open. Retry sends the original file and description with the same key.</Notice>}<fieldset disabled={uploading||uncertain}>
    <Field label="Document File" required hint="PDF, JPG, PNG or WebP, up to 10 MB."><input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" required onChange={e=>{const f=e.target.files?.[0]||null;setFileToUpload(f);if(f&&!uploadTitle)setUploadTitle(f.name.replace(/\.[^/.]+$/,''))}}/></Field>
    <Field label={uploadCategory==='other'?'Specify Document Description':'Title / Description'} required={uploadCategory==='other'}><input value={uploadTitle} maxLength={255} required={uploadCategory==='other'} onChange={e=>setUploadTitle(e.target.value)}/></Field>
    <Field label="Category" required><select value={uploadCategory} onChange={e=>setUploadCategory(e.target.value)}>{DOCUMENT_CATEGORIES.filter(([v])=>!documentsOnly||v!=='hmo_card').map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></Field>
   </fieldset><div className="doc-actions"><Button variant="ghost" disabled={uploading||uncertain} onClick={closeUpload}>Cancel</Button><Button type="submit" disabled={uploading}>{uploading?'Uploading…':uncertain?'Retry same upload':'Upload'}</Button></div></form>
  </Modal>
  <Modal open={!!retractTarget} onClose={()=>{if(!retracting&&!retractUncertain)setRetractTarget(null)}} title="Retract Document" subtitle="Download access is removed. The clinic retains the record and file."><p>{retractTarget?.title} · {retractTarget?.patient?.code}</p>{retractError&&<p role="alert">{retractError}</p>}{retractUncertain&&<p>Retraction is unconfirmed. Retry uses the original document and reason.</p>}<Field label="Reason for Retraction" required><textarea rows={3} maxLength={255} disabled={retracting||retractUncertain} value={retractReason} onChange={e=>setRetractReason(e.target.value)}/></Field><div className="doc-actions"><Button variant="ghost" disabled={retracting||retractUncertain} onClick={()=>setRetractTarget(null)}>Cancel</Button><Button variant="danger" disabled={retracting||!retractReason.trim()} onClick={handleRetract}>{retracting?'Retracting…':'Confirm Retraction'}</Button></div></Modal>
 </div>
}
