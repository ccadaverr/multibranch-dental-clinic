import React, { useState, useEffect } from 'react'
import { Button, Empty, Field, Modal, Notice, PageHeader, Status } from '../components.jsx'
import { PageHead } from '../patient/ui.jsx'
import { dateLabel } from '../logic.js'
import { patientContext } from '../patient-view.js'
import { DefinitionList, RecordCard } from '../patient-ui.jsx'
import { loadPatientRecord } from '../patient-records-api.js'
import { commandKey } from '../appointments-api.js'
import { ChangeEmailButton } from './ChangeEmailDialog.jsx'
import { fetchMyDocuments, fetchMyConsents, submitDocumentUpload, retractDocument, downloadDocumentFile } from '../documents-api.js'

const NO_ACCOUNT = <Notice tone="warning" title="We couldn’t confirm your account">Reopen your workspace, or ask the clinic to check your account access.</Notice>

// documentsOnly: the patient portal (src/patient) shows only the server-backed consents and documents here; its own Profile page shows the profile.
export function PatientMePage({ store, setPage, documentsOnly = false }) {
  const { state, toast } = store, session = store.session
  const ctx = patientContext(state, session)
  const [docs, setDocs] = useState([])
  const [consents, setConsents] = useState([])
  const [loading, setLoading] = useState(true)
  const [docError, setDocError] = useState('')
  const [consentError, setConsentError] = useState('')
  const uploadKey = React.useRef(commandKey())
  const [uploadOpen, setUploadOpen] = useState(false)
  const [fileToUpload, setFileToUpload] = useState(null)
  const [uploadTitle, setUploadTitle] = useState('')
  const [otherDescription, setOtherDescription] = useState('')
  const [descriptionError, setDescriptionError] = useState('')
  const [uploadCategory, setUploadCategory] = useState('valid_id')
  const [uploading, setUploading] = useState(false)
  const [retractTarget, setRetractTarget] = useState(null)
  const [retractReason, setRetractReason] = useState('')

  // M4: with a server session the Patient's profile is read from the clinic server (their own record, resolved from the
  // account, never a supplied id). The browser projection created at sign-in is not shown as the profile.
  const serverProfile = !!(session?.serverUserId && session?.patientPublicId)
  const [profile, setProfile] = useState({ status: serverProfile ? 'loading' : 'local', record: null, message: '' })
  const [profileAttempt, setProfileAttempt] = useState(0)
  useEffect(() => {
    if (!serverProfile) return undefined
    let live = true
    setProfile({ status: 'loading', record: null, message: '' })
    loadPatientRecord(session.patientPublicId).then(result => {
      if (live) setProfile(result.ok ? { status: 'ready', record: result.record, message: '' } : { status: 'error', record: null, message: result.message })
    })
    return () => { live = false }
  }, [serverProfile, session?.patientPublicId, profileAttempt])

  // Failures are shown (with Retry) — never as an empty list.
  const reload = async () => {
    setLoading(true)
    setDocError('')
    setConsentError('')
    const [documents, consentRecords] = await Promise.allSettled([fetchMyDocuments(), fetchMyConsents()])
    if (documents.status === 'fulfilled') setDocs(documents.value)
    else { setDocs([]); setDocError(documents.reason?.message || 'Your documents could not be loaded.') }
    if (consentRecords.status === 'fulfilled') setConsents(consentRecords.value)
    else { setConsents([]); setConsentError(consentRecords.reason?.message || 'Your consent records could not be loaded.') }
    setLoading(false)
  }

  useEffect(() => {
    reload()
  }, [])

  if (!ctx && !documentsOnly) return NO_ACCOUNT
  const branch = ctx && state.branches.find(b => b.id === ctx.patient.preferredBranchId)

  const handleUpload = async (e) => {
    e.preventDefault()
    if (!fileToUpload) return toast('Please select a file to upload.', 'warning')
    const formData = new FormData()
    formData.append('file', fileToUpload)
    formData.append('category', uploadCategory)
    if (uploadCategory === 'other') {
      if (!otherDescription.trim()) return setDescriptionError('Specify the document type.')
      formData.append('other_description', otherDescription.trim())
    }
    if (uploadTitle.trim()) formData.append('title', uploadTitle.trim())

    setUploading(true)
    try {
      await submitDocumentUpload(formData, uploadKey.current)
      uploadKey.current = commandKey()
      toast('Document uploaded successfully.', 'success')
      setUploadOpen(false)
      setFileToUpload(null)
      setUploadTitle('')
      setOtherDescription('')
      setDescriptionError('')
      await reload()
    } catch (err) {
      if (err.errors?.other_description?.[0]) setDescriptionError(err.errors.other_description[0])
      toast(err.message || 'Upload failed.', 'warning')
    } finally {
      setUploading(false)
    }
  }

  const handleDownload = async (doc) => {
    try {
      await downloadDocumentFile(doc.id, doc.originalFilename)
    } catch (err) {
      toast(err.message || 'Download failed.', 'warning')
    }
  }

  const handleRetract = async () => {
    if (!retractTarget) return
    if (!retractReason.trim()) return toast('Please provide a reason for retraction.', 'warning')
    try {
      await retractDocument(retractTarget.id, retractReason.trim())
      toast('Document retracted.', 'success')
      setRetractTarget(null)
      setRetractReason('')
      await reload()
    } catch (err) {
      toast(err.message || 'Retraction failed.', 'warning')
    }
  }

  return <div className="pt-page">
    {documentsOnly ? <PageHead eyebrow="Records & Billing" title="Documents" text="Your clinic consents and documents on file with the clinic."/>
      : <PageHeader kicker="Your account" title="Me" text="Your profile information, documents, and clinic consents."/>}

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

    <section className="pt-record" aria-labelledby="pt-me-consents-title" style={{ marginTop: '20px' }}>
      <header><div><h2 id="pt-me-consents-title" className="pt-record-title">Consents & Agreements</h2><p className="pt-record-sub">Active consent records on file with the clinic.</p></div></header>
      {loading ? <Notice>Loading consents...</Notice> : consentError ? (
        <Notice tone="warning" title="Consent records unavailable">{consentError} <Button size="sm" variant="ghost" onClick={reload}>Retry</Button></Notice>
      ) : consents.length === 0 ? (
        <Notice tone="info">No active consent records found.</Notice>
      ) : (
        <div className="pt-list" style={{ marginTop: '12px' }}>
          {consents.map(c => (
            <RecordCard key={c.id} title={c.consentType?.replace(/_/g, ' ')} subtitle={`Version ${c.version} • Signed ${dateLabel(c.signedAt)}`} status={c.status}>
              {c.notes && <p className="pt-hint">{c.notes}</p>}
            </RecordCard>
          ))}
        </div>
      )}
    </section>

    <section className="pt-record" aria-labelledby="pt-me-docs-title" style={{ marginTop: '20px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <div><h2 id="pt-me-docs-title" className="pt-record-title">My Documents</h2><p className="pt-record-sub">{documentsOnly ? 'Clinic-shared records and documents you have uploaded (such as valid IDs, referrals, X-rays, or consent forms).' : 'IDs, insurance cards, and medical records kept in your private clinic record.'}</p></div>
        <Button size="sm" onClick={() => setUploadOpen(true)}>Upload Document</Button>
      </header>

      {loading ? <Notice>Loading documents...</Notice> : docError ? (
        <Notice tone="warning" title="Documents unavailable">{docError} <Button size="sm" variant="ghost" onClick={reload}>Retry</Button></Notice>
      ) : docs.length === 0 ? (
        <Empty title="No documents on file yet" text="You haven't uploaded any documents yet. Use the upload button above to share a valid ID, X-Ray, referral letter, or lab result with the clinic."/>
      ) : (
        <div className="pt-list" style={{ marginTop: '12px' }}>
          {docs.map(doc => (
            <RecordCard key={doc.id} title={doc.title} subtitle={`${doc.originalFilename} • ${doc.fileSizeFormatted} • Uploaded ${dateLabel(doc.createdAt)}${doc.branch?.name ? ` • ${doc.branch.name}` : ''}`} status={doc.status}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                <span className="split-badge info"><b>Type</b><span>{doc.category === 'other' ? 'Other Document' : doc.category?.replace(/_/g, ' ') || 'Document'}</span></span>
                {doc.otherDescription && <span style={{ overflowWrap: 'anywhere' }}>Specified type: {doc.otherDescription}</span>}
                <span className="split-badge"><b>Source</b><span>{doc.uploadedByPatient ? 'Uploaded by you' : 'Shared by clinic'}</span></span>
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                {doc.status === 'Active' && <Button size="sm" variant="soft" onClick={() => handleDownload(doc)}>Download</Button>}
                {doc.status === 'Active' && doc.uploadedByPatient && <Button size="sm" variant="ghost" onClick={() => { setRetractTarget(doc); setRetractReason('') }}>Retract</Button>}
              </div>
              {doc.status === 'Retracted' && (
                <Notice tone="warning" style={{ marginTop: '8px' }}>
                  Retracted on {dateLabel(doc.retractedAt)}: {doc.retractionReason}
                </Notice>
              )}
            </RecordCard>
          ))}
        </div>
      )}
    </section>

    <Modal open={uploadOpen} onClose={() => !uploading && setUploadOpen(false)} title="Upload Document" subtitle="Documents are kept in private clinic storage. They are type-checked but not scanned for malware, and are visible only to you and authorized clinic staff.">
      <form onSubmit={handleUpload} className="form-grid">
        <Field label="Document File" required hint="PDF, JPG, PNG, or WebP. Max 10MB.">
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            onChange={e => {
              const file = e.target.files?.[0]
              setFileToUpload(file || null)
              if (file && !uploadTitle) setUploadTitle(file.name.replace(/\.[^/.]+$/, ''))
            }}
            required
          />
        </Field>
        <Field label="Title / Description">
          <input value={uploadTitle} maxLength={255} onChange={e => setUploadTitle(e.target.value)} placeholder="e.g., Driver’s License" />
        </Field>
        <Field label="Category" required>
          <select value={uploadCategory} onChange={e => {
            const category = e.target.value
            setUploadCategory(category)
            setDescriptionError('')
            if (category !== 'other') setOtherDescription('')
          }}>
            <option value="valid_id">Valid ID (Passport, Driver's License, Senior/PWD ID)</option>
            <option value="clinical_attachment">Medical / Dental Record, Lab Result, X-Ray</option>
            <option value="referral">Referral Letter / Note</option>
            <option value="consent_document">Consent Form</option>
            <option value="treatment_request">Treatment Request</option>
            {!documentsOnly && <option value="hmo_card">HMO / Insurance Card</option>}
            <option value="other">Other Document</option>
          </select>
        </Field>
        {uploadCategory === 'other' && <Field label="Specify document type" required error={descriptionError}>
          <input value={otherDescription} maxLength={255} required placeholder="e.g., School clearance"
            onChange={e => { setOtherDescription(e.target.value); setDescriptionError('') }} />
        </Field>}
        <div className="span-2" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
          <Button type="button" variant="ghost" onClick={() => setUploadOpen(false)} disabled={uploading}>Cancel</Button>
          <Button type="submit" disabled={uploading}>{uploading ? 'Uploading...' : 'Upload'}</Button>
        </div>
      </form>
    </Modal>

    <Modal open={!!retractTarget} onClose={() => setRetractTarget(null)} title="Retract Document" subtitle="Retracting revokes access to this document.">
      <div className="form-grid">
        <Field label="Reason for Retraction" required hint="Please provide a brief reason (e.g. uploaded outdated card).">
          <textarea value={retractReason} onChange={e => setRetractReason(e.target.value)} rows={3} />
        </Field>
        <div className="span-2" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
          <Button type="button" variant="ghost" onClick={() => setRetractTarget(null)}>Cancel</Button>
          <Button type="button" variant="danger" onClick={handleRetract}>Confirm Retraction</Button>
        </div>
      </div>
    </Modal>
  </div>
}
