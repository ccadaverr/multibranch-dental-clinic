import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { clinicMapOptions, FALLBACK_MAP_VIEW, hasClinicCoordinates } from './clinic-map-options.js'
import { directionsUrl } from './pages/public-data.js'

export function mountClinicMap(container, onTileStatus, onSelectBranch) {
  const map = L.map(container, { ...clinicMapOptions, ...FALLBACK_MAP_VIEW })
  const markers = L.layerGroup().addTo(map)
  let resizeObserver
  let hasTiles = false
  let hasTileError = false
  let showingBranches = false
  let bounds = null
  let fittedView = null
  const fitBranches = () => {
    const padding = Math.min(48, Math.round(Math.min(container.clientWidth, container.clientHeight) * .15))
    map.fitBounds(bounds, { padding: [padding, padding], maxZoom: 16, animate: false })
    fittedView = { center: map.getCenter(), zoom: map.getZoom() }
  }
  const reportUnavailable = () => {
    if (!hasTiles) onTileStatus('error')
  }
  const timer = setTimeout(reportUnavailable, 12000)

  const destroy = () => {
    clearTimeout(timer)
    resizeObserver?.disconnect()
    map.remove()
  }

  try {
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      keepBuffer: 0,
    }).on('tileerror', () => {
      hasTileError = true
    }).on('tileload', () => {
      if (hasTiles) return
      hasTiles = true
      clearTimeout(timer)
      onTileStatus('ready')
    }).on('load', () => {
      if (hasTileError) reportUnavailable()
    }).addTo(map)

    map.invalidateSize({ pan: false })
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        // Keep the fitted directory in view while leaving a user-selected map view alone.
        const stillFitted = fittedView && map.getZoom() === fittedView.zoom && map.getCenter().equals(fittedView.center)
        map.invalidateSize({ debounceMoveend: true })
        if (stillFitted) fitBranches()
      })
      resizeObserver.observe(container)
    }

    const markersByBranch = new Map()
    const setBranches = branches => {
      markers.clearLayers()
      markersByBranch.clear()
      const mapped = branches.filter(hasClinicCoordinates)
      fittedView = null
      if (!mapped.length) {
        if (showingBranches) map.setView(FALLBACK_MAP_VIEW.center, FALLBACK_MAP_VIEW.zoom, { animate: false })
        showingBranches = false
        return
      }
      showingBranches = true

      const coordinates = mapped.map(branch => [branch.latitude, branch.longitude])
      map.invalidateSize({ pan: false })
      if (coordinates.length === 1) {
        map.setView(coordinates[0], 15, { animate: false })
      } else {
        bounds = L.latLngBounds(coordinates)
        fitBranches()
      }

      for (const branch of mapped) {
        const content = document.createElement('span')
        // The label can move away from closely spaced pins while the dot stays at the exact coordinate.
        content.className = branch.number === '02' ? 'clinic-pin pin-02' : 'clinic-pin'
        const dot = document.createElement('i')
        content.append(dot)
        if (branch.number) {
          const label = document.createElement('b')
          label.textContent = branch.number
          content.append(label)
        }
        const info = document.createElement('div')
        const name = document.createElement('strong')
        name.textContent = branch.name
        const address = document.createElement('span')
        address.textContent = branch.address
        const directions = document.createElement('a')
        directions.href = directionsUrl(branch)
        directions.target = '_blank'
        directions.rel = 'noreferrer'
        directions.textContent = 'Get directions'
        info.className = 'lp-map-popup'
        info.append(name, address)
        if (branch.phone) {
          const phone = document.createElement('span')
          phone.textContent = branch.phone
          info.append(phone)
        }
        info.append(directions)
        const marker = L.marker([branch.latitude, branch.longitude], {
          title: branch.name,
          icon: L.divIcon({ className: 'clinic-map-marker', html: content, iconSize: [44, 44], iconAnchor: [22, 22] }),
        }).addTo(markers).bindPopup(info, { maxWidth: 224, offset: [0, -22] })
        const icon = marker.getElement()
        icon?.setAttribute('aria-label', branch.name)
        icon?.addEventListener('keydown', event => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          event.stopPropagation()
          marker.openPopup()
        })
        marker.on('popupopen', () => onSelectBranch?.(branch.id))
        markersByBranch.set(branch.id, marker)
      }
    }

    return { setBranches, destroy, focusBranch: id => markersByBranch.get(id)?.openPopup() }
  } catch (error) {
    destroy()
    throw error
  }
}
