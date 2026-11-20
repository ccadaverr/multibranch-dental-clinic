import React, { useEffect, useRef, useState } from 'react'
import { hasClinicCoordinates } from '../clinic-map-options.js'

export function LocationMap({ branches, branchStatus, reload, selectedBranch, onSelectBranch }) {
  const canvas = useRef(null)
  const selectBranch = useRef(onSelectBranch)
  selectBranch.current = onSelectBranch
  const [map, setMap] = useState(null)
  const [status, setStatus] = useState('loading')
  const [retried, setRetried] = useState(false)
  const geographicPreview = !branches.some(hasClinicCoordinates)
  const showBranchNotice = branchStatus === 'error' || (branchStatus === 'loading' && retried)

  useEffect(() => {
    let active = true
    let instance
    import('../clinic-map.js').then(({ mountClinicMap }) => {
      if (!active) return
      instance = mountClinicMap(canvas.current, next => { if (active) setStatus(next) }, id => selectBranch.current?.(id))
      setMap(instance)
    }).catch(() => { if (active) setStatus('error') })

    return () => {
      active = false
      instance?.destroy()
    }
  }, [])

  useEffect(() => { map?.setBranches(branches) }, [map, branches])
  useEffect(() => { if (selectedBranch) map?.focusBranch(selectedBranch) }, [map, branches, selectedBranch])

  return <figure className="site-location-map">
    <div className="site-map-frame">
      <div className="site-map-canvas" ref={canvas} role="region" aria-label={geographicPreview ? 'Bocaue area map preview' : 'Interactive clinic locations map'}/>
      {status === 'error' && <p className="site-map-notice" role="status">Map tiles couldn't be loaded.</p>}
    </div>
    <figcaption className="site-map-caption">
      <div className="site-map-meta">
        <span>{geographicPreview ? 'Bocaue area · Regional map preview' : 'Clinic locations map'}</span>
        {status === 'ready' && <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>}
      </div>
      {showBranchNotice && <div className="site-map-branch-status">
        <p role="status">{branchStatus === 'error' ? 'Clinic locations are temporarily unavailable.' : 'Loading clinic locations…'}</p>
        <button type="button" className="lp-retry" aria-disabled={branchStatus === 'loading'} onClick={() => {
          if (branchStatus === 'loading') return
          setRetried(true)
          reload()
        }}>{branchStatus === 'loading' ? 'Retrying…' : 'Retry'}</button>
      </div>}
    </figcaption>
  </figure>
}
