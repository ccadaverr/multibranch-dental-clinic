import React from 'react'
import { toothLabel } from './toothShapes.js'

export function ChartSummary({ data, onSelectTooth }) {
  const numbering = data?.settings?.numbering || 'fdi'
  const current = data?.current || []
  const summary = data?.summary || []

  const nonBaselineCurrent = current.filter(c => !/^(healthy|sound)$/i.test(c.status?.trim() || ''))
  const totalFindings = summary.length > 0
    ? summary.reduce((sum, g) => sum + g.count, 0)
    : nonBaselineCurrent.length

  // If backend provided summary, use it; otherwise compute from non-baseline current
  const grouped = summary.length > 0
    ? summary
    : Object.entries(
        nonBaselineCurrent.reduce((acc, c) => {
          acc[c.status] = acc[c.status] || []
          acc[c.status].push(c)
          return acc
        }, {})
      ).map(([status, teeth]) => ({
        status,
        count: teeth.length,
        teeth,
      }))

  return (
    <div className="od-summary-panel" aria-label="Dental chart overall summary">
      <div className="od-summary-header">
        <h4 className="od-summary-title">All findings ({totalFindings})</h4>
        <p className="od-muted" style={{ margin: 0, fontSize: '14px' }}>
          Tap any tooth chip to view its history and details.
        </p>
      </div>

      {grouped.length === 0 ? (
        <div className="od-summary-empty">
          <p className="od-muted">No current nonbaseline findings. Select a tooth to review any recorded baseline or history.</p>
        </div>
      ) : (
        <div className="od-summary-groups">
          {grouped.map(g => (
            <div key={g.status} className="od-summary-group">
              <div className="od-group-header">
                <span className="od-group-name">{g.status}</span>
                <span className="od-group-count">{g.count}</span>
              </div>
              <div className="od-group-chips">
                {g.teeth.map(t => {
                  const num = toothLabel(t.tooth, numbering)
                  const surfaceStr = t.surfaces?.length ? ` · ${t.surfaces.join('')}` : ''
                  return (
                    <button
                      key={`${t.tooth}-${(t.surfaces || []).join('')}`}
                      type="button"
                      className="od-chip-btn"
                      onClick={() => onSelectTooth(t.tooth)}
                      aria-label={`Select tooth ${num}`}
                    >
                      <span className="od-chip-num">Tooth {num}</span>
                      {surfaceStr && <span className="od-chip-surf">{surfaceStr}</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
