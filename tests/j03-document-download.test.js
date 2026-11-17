import test from 'node:test'
import assert from 'node:assert/strict'
import {downloadDocumentFile} from '../src/documents-api.js'
import {fileSha256} from '../src/patient/document-workflow.js'
const body=new Blob(['Synthetic file'],{type:'application/pdf'}),checksum=await fileSha256(body)
let clicks=0
const original={fetch:globalThis.fetch,window:globalThis.window,document:globalThis.document}
function setup(change={}){
 clicks=0
 globalThis.window={URL:{createObjectURL:()=> 'blob:synthetic',revokeObjectURL:()=>{}}}
 globalThis.document={createElement:()=>({click:()=>clicks++,remove(){}}),body:{appendChild(){}}}
 globalThis.fetch=async()=>({ok:true,headers:new Map([['X-Document-Id','doc'],['X-Patient-Id','patient'],['Content-Type','application/pdf']]),blob:async()=>body,...change})
}
const options={patientId:'patient',checksum,mimeType:'application/pdf',size:body.size,isCurrent:()=>true}
test('document download requires exact document/Patient headers, type, size and digest',async()=>{
 try{
  setup();await downloadDocumentFile('doc','synthetic.pdf',options);assert.equal(clicks,1)
  for(const headers of [new Map([['X-Document-Id','foreign'],['X-Patient-Id','patient'],['Content-Type','application/pdf']]),new Map([['X-Document-Id','doc'],['X-Patient-Id','foreign'],['Content-Type','application/pdf']]),new Map([['X-Document-Id','doc'],['X-Patient-Id','patient'],['Content-Type','text/html']])]){setup({headers});await assert.rejects(()=>downloadDocumentFile('doc','synthetic.pdf',options));assert.equal(clicks,0)}
  setup({blob:async()=>new Blob(['Corrupted file'])});await assert.rejects(()=>downloadDocumentFile('doc','synthetic.pdf',options));assert.equal(clicks,0)
 }finally{Object.assign(globalThis,original)}
})
test('a download fetched before leaving the Patient view never creates a file after ownership ends',async()=>{
 try{
  setup();let current=true,release;globalThis.fetch=()=>new Promise(r=>release=r)
  const pending=downloadDocumentFile('doc','synthetic.pdf',{...options,isCurrent:()=>current});current=false;release({ok:true});await assert.rejects(()=>pending);assert.equal(clicks,0)
 }finally{Object.assign(globalThis,original)}
})
