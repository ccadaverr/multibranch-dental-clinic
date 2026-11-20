export const clinicMapOptions = Object.freeze({
  scrollWheelZoom: false,
  attributionControl: false, // The map figure supplies persistent attribution.
  zoomAnimation: false,
  fadeAnimation: false,
  markerZoomAnimation: false,
})

// The existing Bocaue-area starting point in branch-map.js, used here only for a geographic preview.
export const FALLBACK_MAP_VIEW = { center: [14.8016, 120.9328], zoom: 13 }

export function hasClinicCoordinates({ latitude, longitude }) {
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
    && (latitude !== 0 || longitude !== 0)
}
