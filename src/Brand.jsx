import React from 'react'
import { clinic } from './clinic-config.js'

// Only Staff workspaces replace the network identity text with their actual assigned
// branch label. The approved clinic logo and global identity remain unchanged.
export function Brand({className='', branchName=null}) {
  return <div className={`brand ${className}`.trim()}><img className="clinic-logo" src={clinic.logo} alt="" width="48" height="48"/><div><strong>{branchName || clinic.nameLine}</strong><span>{branchName ? 'Assigned clinic' : clinic.subtitle}</span></div></div>
}
