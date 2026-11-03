import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import './odontogram.css'
import { ConfirmDialog } from '../../components.jsx'
import {
  ADULT_FRONT_ROWS,
  ADULT_LOWER,
  ADULT_UPPER,
  ARCH_COORDS,
  getToothFullName,
  getToothType,
  PRIMARY_FRONT_ROWS,
  PRIMARY_LOWER,
  PRIMARY_UPPER,
  QUADRANT_NAMES,
  toothLabel,
} from './toothShapes.js'
import { ToothTimeline } from './ToothTimeline.jsx'
import { ChartSummary } from './ChartSummary.jsx'

export function Odontogram({
  data,
  selected = null,
  onSelect,
  canRecord = false,
  onRecord,
  branches = [],
  activeBranchId = null,
  defaultView = 'top',
  recordingPending = false,
  onDirtyChange,
}) {
  const [view, setView] = useState(defaultView) // 'top' | 'front'
  const [set, setSet] = useState('adult') // 'adult' | 'primary'
  const [pendingSelection, setPendingSelection] = useState(null)
  const pendingTarget = useRef(null), toothNodes = useRef(new Map()), restoreTooth = useRef(null)
  const [focusedTooth, setFocusedTooth] = useState(selected || ADULT_UPPER[0])
  const chartId = useId()
  const dirty = useRef(false), selectionGeneration = useRef(0), selection = useRef(selected)
  selection.current = selected
  const generation = selectionGeneration.current
  const reportDirty = value => { dirty.current = value; onDirtyChange?.(value) }
  const applySelection = target => {
    const previous = selection.current
    // Invalidate before React commits, including a rapid A -> B -> A selection.
    selectionGeneration.current++
    selection.current = target.tooth
    reportDirty(false)
    // Back/summary controls can disappear. Restore to the surviving diagram
    // button; native selectors and dentition buttons keep their own focus.
    if (!target.trigger?.matches('select, .od-segmented-btn')) restoreTooth.current = target.tooth || previous
    if (target.tooth) setFocusedTooth(target.tooth)
    setSet(target.set); onSelect(target.tooth); setPendingSelection(null)
  }
  const cancelSelection = () => { pendingTarget.current = null; setPendingSelection(null) }
  const confirmSelection = () => {
    const target = pendingTarget.current
    if (!target) return
    // Consume before React commits so repeated activation cannot apply twice.
    pendingTarget.current = null
    applySelection(target)
  }
  const requestSelection = (tooth, dentition = tooth ? (PRIMARY_UPPER.includes(tooth) || PRIMARY_LOWER.includes(tooth) ? 'primary' : 'adult') : set) => {
    if (tooth === selection.current && dentition === set) return
    const target = { tooth, set: dentition, trigger: document.activeElement }
    if (canRecord && dirty.current) { pendingTarget.current = target; setPendingSelection(target) }
    else applySelection(target)
  }
  useEffect(() => {
    const tooth = restoreTooth.current
    restoreTooth.current = null
    if (tooth) toothNodes.current.get(tooth)?.focus()
  }, [selected, set, generation])

  const currentMap = useMemo(() => {
    const map = {}
    for (const c of (data?.current || [])) {
      if (!map[c.tooth]) map[c.tooth] = []
      map[c.tooth].push(c)
    }
    return map
  }, [data])

  const numbering = data?.settings?.numbering || 'fdi'
  const upperTeeth = set === 'adult' ? ADULT_UPPER : PRIMARY_UPPER
  const lowerTeeth = set === 'adult' ? ADULT_LOWER : PRIMARY_LOWER
  const frontRows = set === 'adult' ? ADULT_FRONT_ROWS : PRIMARY_FRONT_ROWS
  const visibleTeeth = [...upperTeeth, ...lowerTeeth]
  const tabTooth = visibleTeeth.includes(focusedTooth) ? focusedTooth : upperTeeth[0]
  const toothDescription = t => `${getToothFullName(t)}; patient's ${[1, 4, 5, 8].includes(Number(t[0])) ? 'right' : 'left'}; FDI ${t}.`
  const toothKeyboard = (e, t) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (!e.repeat) requestSelection(t)
      return
    }
    const index = visibleTeeth.indexOf(t), rowLength = upperTeeth.length
    let next
    if (e.key === 'ArrowRight') next = Math.min(index + 1, visibleTeeth.length - 1)
    if (e.key === 'ArrowLeft') next = Math.max(index - 1, 0)
    if (e.key === 'ArrowDown') next = index < rowLength ? index + rowLength : index
    if (e.key === 'ArrowUp') next = index >= rowLength ? index - rowLength : index
    if (e.key === 'Home') next = 0
    if (e.key === 'End') next = visibleTeeth.length - 1
    if (next !== undefined) {
      e.preventDefault()
      toothNodes.current.get(visibleTeeth[next])?.focus()
    }
  }
  const toothAccessibility = t => ({
    ref: node => { if (node) toothNodes.current.set(t, node); else toothNodes.current.delete(t) },
    tabIndex: tabTooth === t ? 0 : -1,
    'aria-pressed': selected === t,
    'aria-describedby': `${chartId}-${t}`,
    onFocus: () => setFocusedTooth(t),
    onKeyDown: e => toothKeyboard(e, t),
  })

  const renderTopTooth = (t) => {
    const coords = ARCH_COORDS[t]
    if (!coords) return null
    const entries = currentMap[t] || []
    const isSelected = selected === t
    const hasFinding = entries.some(c => !/^(healthy|sound)$/i.test(c.status?.trim() || ''))
    const type = getToothType(t)
    const label = toothLabel(t, numbering)
    const statusLabel = entries.map(c => c.status).join(', ')

    return (
      <g
        key={t}
        data-tooth={t}
        role="button"
        {...toothAccessibility(t)}
        className={`od-tooth ${isSelected ? 'is-selected' : ''} ${hasFinding ? 'has-finding' : ''}`}
        transform={`translate(${coords.x}, ${coords.y})`}
        onClick={() => requestSelection(t)}
        aria-label={`Tooth ${label}${statusLabel ? `: ${statusLabel}` : ''}`}
      >
        <desc id={`${chartId}-${t}`}>{toothDescription(t)}</desc>
        {/* Inner rotated group for anatomical crown orientation */}
        <g transform={`rotate(${coords.rotDeg})`}>
          {type === 'molar' && (
            <>
              <path
                d="M -13 -11 C -13 -13, 13 -13, 13 -11 C 14 -7, 14 7, 13 11 C 13 13, -13 13, -13 11 C -14 7, -14 -7, -13 -11 Z"
                className="od-tooth-shape"
              />
              <path d="M -9 0 L 9 0 M 0 -9 L 0 9" className="od-fissure" />
            </>
          )}

          {type === 'premolar' && (
            <>
              <path
                d="M -9 -7 C -9 -9, 9 -9, 9 -7 C 10 -3, 10 3, 9 7 C 9 9, -9 9, -9 7 C -10 3, -10 -3, -9 -7 Z"
                className="od-tooth-shape"
              />
              <path d="M -6 0 L 6 0" className="od-fissure" />
            </>
          )}

          {type === 'canine' && (
            <>
              <path
                d="M 0 -8 L 8 -1 C 9 4, 5 8, 0 8 C -5 8, -9 4, -8 -1 Z"
                className="od-tooth-shape"
              />
              <path d="M 0 -6 L 0 3" className="od-fissure" />
            </>
          )}

          {type === 'incisor' && (
            <>
              <path
                d="M -8 -4 C -8 -6, 8 -6, 8 -4 C 9 0, 8 4, 7 5 C 4 6, -4 6, -7 5 C -8 4, -9 0, -8 -4 Z"
                className="od-tooth-shape"
              />
              <path d="M -5 0 L 5 0" className="od-fissure" />
            </>
          )}
        </g>

        {/* Tooth number outside the arch */}
        <text
          x={coords.numX - coords.x}
          y={coords.numY - coords.y}
          textAnchor="middle"
          dominantBaseline="central"
          className="od-tooth-num"
        >
          {label}
        </text>
      </g>
    )
  }

  // Front View rendering (preserves quadrant facial view with bug-free coordinates)
  const W = 46
  const H = 64
  const renderFrontQuadrant = (teeth, qi) => {
    const isUpper = qi < 2
    return (
      <figure key={qi} className="od-front-quadrant">
        <figcaption>{QUADRANT_NAMES[qi]}</figcaption>
        <svg viewBox={`0 0 ${teeth.length * W} ${H}`} role="group" aria-label={`${QUADRANT_NAMES[qi]} teeth`}>
          {teeth.map((t, i) => {
            const entries = currentMap[t] || []
            const isSelected = selected === t
            const hasFinding = entries.some(c => !/^(healthy|sound)$/i.test(c.status?.trim() || ''))
            const label = toothLabel(t, numbering)
            const isMissing = entries.some(c => /^(missing|extracted)$/i.test(c.status?.trim() || ''))
            const statusLabel = entries.map(c => c.status).join(', ')
            const toothPath = isUpper
              ? "M 15 5 C 17 5, 19 11, 20 18 C 21 11, 23 5, 25 5 C 29 9, 27 20, 28 26 C 29 29, 31 34, 31 40 C 31 47, 26 49, 20 47 C 14 49, 9 47, 9 40 C 9 34, 11 29, 12 26 C 13 20, 11 9, 15 5 Z"
              : "M 9 14 C 9 7, 14 5, 20 7 C 26 5, 31 7, 31 14 C 31 20, 29 25, 28 28 C 27 34, 29 45, 25 49 C 23 49, 21 43, 20 36 C 19 43, 17 49, 15 49 C 11 45, 13 34, 12 28 C 11 25, 9 20, 9 14 Z"
            const cervicalLine = isUpper ? "M 12 26 C 16 28, 24 28, 28 26" : "M 12 28 C 16 26, 24 26, 28 28"

            return (
              <g
                key={t}
                data-tooth={t}
                role="button"
                {...toothAccessibility(t)}
                className={`od-tooth ${isSelected ? 'is-selected' : ''} ${hasFinding ? 'has-finding' : ''}`}
                transform={`translate(${i * W + 3}, 4)`}
                onClick={() => requestSelection(t)}
                aria-label={`Tooth ${label}${statusLabel ? `: ${statusLabel}` : ''}`}
              >
                <desc id={`${chartId}-${t}`}>{toothDescription(t)}</desc>
                <rect
                  width={W - 6}
                  height={H - 10}
                  rx="10"
                  className="od-tooth-shape"
                />
                <path
                  d={toothPath}
                  fill={hasFinding ? '#e0e7ff' : '#ffffff'}
                  stroke={isSelected ? '#4338ca' : (hasFinding ? '#6366f1' : '#94a3b8')}
                  strokeWidth={isSelected ? 2.2 : 1.4}
                  strokeDasharray={isMissing ? "3 2" : "none"}
                />
                <path d={cervicalLine} fill="none" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="1.5 1.5" />
                {isMissing && <line x1="10" y1="10" x2="30" y2="44" stroke="#ef4444" strokeWidth="2" />}
                <text x={(W - 6) / 2} y={isUpper ? 42 : 19} textAnchor="middle" className="od-tooth-num">{label}</text>
              </g>
            )
          })}
        </svg>
      </figure>
    )
  }

  return (
    <div className="od-wrap">
      <ConfirmDialog open={!!pendingSelection} title="Leave this tooth?" cancelLabel="Stay" confirmLabel="Discard changes and continue" onCancel={cancelSelection} onConfirm={confirmSelection}>
        <p>Unsaved changes for Tooth {selected ? toothLabel(selected, numbering) : ''} will be discarded. A submitted request keeps its original tooth.</p>
      </ConfirmDialog>
      {/* Top control bar: View Switcher and Teeth Set Switcher */}
      <div className="od-top-bar">
        <div className="od-segmented" role="group" aria-label="Dental Chart View">
          <button
            type="button"
            aria-pressed={view === 'top'}
            className={`od-segmented-btn ${view === 'top' ? 'is-active' : ''}`}
            onClick={() => setView('top')}
          >
            Top view (Arch)
          </button>
          <button
            type="button"
            aria-pressed={view === 'front'}
            className={`od-segmented-btn ${view === 'front' ? 'is-active' : ''}`}
            onClick={() => setView('front')}
          >
            Front view
          </button>
        </div>

        <div className="od-segmented" role="group" aria-label="Dentition Set">
          <button
            type="button"
            aria-pressed={set === 'adult'}
            className={`od-segmented-btn ${set === 'adult' ? 'is-active' : ''}`}
            onClick={() => { if (set !== 'adult') requestSelection(null, 'adult') }}
          >
            Permanent (32)
          </button>
          <button
            type="button"
            aria-pressed={set === 'primary'}
            className={`od-segmented-btn ${set === 'primary' ? 'is-active' : ''}`}
            onClick={() => { if (set !== 'primary') requestSelection(null, 'primary') }}
          >
            Primary (20)
          </button>
        </div>
      </div>

      {/* Main 2-column layout: Canvas on Left, Panel on Right */}
      <div className="od-main-layout">
        <div className="od-canvas-container">
          <label className="od-tooth-chooser">
            Choose tooth
            <select tabIndex={0} value={selected || ''} onChange={e => requestSelection(e.target.value || null)}>
              <option value="">All findings</option>
              {visibleTeeth.map(t => <option key={t} value={t}>Tooth {toothLabel(t, numbering)} — {getToothFullName(t)}{numbering === 'universal' ? ` (FDI ${t})` : ''}</option>)}
            </select>
          </label>
          <p id={`${chartId}-keys`} className="od-key-help">Diagram: Left/Right moves between teeth; Up/Down changes arch; Home/End moves to first/last. Enter or Space opens details; Tab leaves the diagram.</p>
          <div className="od-diagram" role="toolbar" aria-label="Tooth selection" aria-describedby={`${chartId}-keys`}>
          {view === 'top' ? (
            <svg
              className="od-arch-svg"
              viewBox="0 0 540 500"
              role="group"
              aria-label={`Dental arch diagram (${set === 'adult' ? '32 Permanent teeth' : '20 Primary teeth'})`}
            >
              {/* Faint Center Crosshair */}
              <line x1="40" y1="250" x2="500" y2="250" className="od-crosshair" />
              <line x1="270" y1="30" x2="270" y2="470" className="od-crosshair" />
              <text x="50" y="242" className="od-crosshair-label">Right</text>
              <text x="470" y="242" className="od-crosshair-label" textAnchor="end">Left</text>
              <text x="278" y="42" className="od-crosshair-label">Upper</text>
              <text x="278" y="465" className="od-crosshair-label">Lower</text>

              {/* Upper Arch Teeth */}
              <g className="od-upper-arch" role="group" aria-label="Upper maxillary arch">
                {upperTeeth.map(renderTopTooth)}
              </g>

              {/* Lower Arch Teeth */}
              <g className="od-lower-arch" role="group" aria-label="Lower mandibular arch">
                {lowerTeeth.map(renderTopTooth)}
              </g>
            </svg>
          ) : (
            <div className="od-front-quadrants">
              {frontRows.map((teeth, qi) => renderFrontQuadrant(teeth, qi))}
            </div>
          )}
          </div>

          <div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--muted, #64748b)' }}>
            Numbering: <b>{numbering === 'universal' ? 'Universal' : 'FDI'}</b> · Teeth with findings highlighted in indigo.
          </div>
        </div>

        {/* Right Panel: Tooth Timeline (if selected) or Chart Summary (if none selected) */}
        <aside className="od-side-panel">
          {selected ? (
            <ToothTimeline
              key={selected + ':' + generation}
              tooth={selected}
              isCurrent={() => selectionGeneration.current === generation && selection.current === selected}
              onDirtyChange={reportDirty}
              recordingPending={recordingPending}
              data={data}
              onBack={() => requestSelection(null)}
              canRecord={canRecord}
              onRecord={onRecord}
              branches={branches}
              activeBranchId={activeBranchId}
            />
          ) : (
            <ChartSummary
              data={data}
              onSelectTooth={requestSelection}
            />
          )}
        </aside>
      </div>
    </div>
  )
}
