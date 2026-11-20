import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useLoader, useThree } from '@react-three/fiber'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

function Camera({ reset, fallback }) {
  const { camera, gl, invalidate, size } = useThree()
  useEffect(() => {
    const canvas = gl.domElement
    const lost = () => fallback.current()
    canvas.addEventListener('webglcontextlost', lost)
    return () => canvas.removeEventListener('webglcontextlost', lost)
  }, [gl, fallback])
  useEffect(() => {
    const distance = Math.max(13, 13 * size.height / size.width)
    camera.position.set(0, distance * .42, distance)
    const orbit = new OrbitControls(camera, gl.domElement)
    orbit.target.set(0, 0, -.25)
    orbit.enablePan = false
    orbit.minDistance = 7
    orbit.maxDistance = distance * 1.6
    orbit.minPolarAngle = .18
    orbit.maxPolarAngle = Math.PI - .18
    orbit.addEventListener('change', invalidate)
    orbit.update()
    invalidate()
    return () => orbit.dispose()
  }, [camera, gl, invalidate, reset, size.width, size.height])
  return null
}

// A scalloped gingival ridge follows the same elliptical arch as the FDI meshes.
function Gingiva({ primary, upper }) {
  const geometry = useMemo(() => {
    const positions = [], indices = [], rows = primary ? 80 : 128, sides = 20
    const spacing = primary ? .345 : .218
    for (let row = 0; row <= rows; row++) {
      const angle = (2 * row / rows - 1) * spacing * (primary ? 5 : 8)
      const taper = .04 + .96 * Math.min(1, Math.sin(Math.PI * row / rows) * 10)
      for (let side = 0; side < sides; side++) {
        const t = 2 * Math.PI * side / sides
        const scallop = Math.cos(angle * 2 * Math.PI / spacing)
        const radius = Math.cos(t) * taper * (.41 - .035 * scallop)
        const y = 1.92 + taper * .43 * Math.sin(t) - .095 * scallop * Math.max(0, -Math.sin(t))
        positions.push(Math.sin(angle) * ((primary ? 2.85 : 4.2) + radius), upper ? y : -y,
          (Math.cos(angle) - .54) * (primary ? 5 : 6.9) + radius * Math.cos(angle))
        if (row) {
          const a = row * sides + side, b = row * sides + (side + 1) % sides
          if (upper) indices.push(a-sides, a, b-sides, b-sides, a, b)
          else indices.push(a-sides, b-sides, a, b-sides, b, a)
        }
      }
    }
    const shape = new BufferGeometry()
    shape.setAttribute('position', new Float32BufferAttribute(positions,3))
    shape.setIndex(indices); shape.computeVertexNormals()
    return shape
  }, [primary, upper])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh geometry={geometry}><meshStandardMaterial color="#bb817a" roughness={.65} side={2}/></mesh>
}

function Teeth({ teeth, selected, current, onSelect, arch }) {
  const asset = useLoader(GLTFLoader, '/models/dental-crowns.glb')
  const geometries = useMemo(() => Object.fromEntries(asset.scene.children.map(node => [node.name, node.geometry])), [asset])
  return teeth.map(id => {
    const quadrant = Number(id[0]), index = Number(id[1])
    const primary = quadrant > 4, upper = [1,2,5,6].includes(quadrant)
    if ((arch === 'Upper' && !upper) || (arch === 'Lower' && upper)) return null
    const side = [1,4,5,8].includes(quadrant) ? -1 : 1
    const molar = index >= (primary ? 4 : 6)
    const type = molar ? 'molar' : index < 3 ? 'incisor' : index === 3 ? 'canine' : 'premolar'
    const angle = (index - .5) * (primary ? .345 : .218)
    const x = side * Math.sin(angle) * (primary ? 2.85 : 4.2)
    const z = (Math.cos(angle) - .54) * (primary ? 5 : 6.9)
    const entries = current[id] || []
    const absent = entries.some(row => /^(missing|extracted)$/i.test(row.status))
    const finding = entries.some(row => !/^(healthy|sound)$/i.test(row.status))
    return <mesh key={id} geometry={geometries[type]}
      position={[x, upper ? 1.59 : -1.59, z]} rotation={[upper ? Math.PI : 0, side * angle * (upper ? 1 : -1), 0]}
      scale={[index === 2 ? .88 : 1, primary ? .85 : 1, 1]}
      onClick={event => { event.stopPropagation(); if (event.delta < 5) onSelect(id) }}>
      <meshStandardMaterial roughness={.39} metalness={0} transparent={absent} opacity={absent ? .28 : 1}
        color={selected === id ? '#78acc6' : finding ? '#dcc09b' : index % 3 ? '#f5ebd9' : '#f1e6d3'}/>
    </mesh>
  })
}

export default function DentalModel({ teeth, selected, current, onSelect, onFallback }) {
  const [arch, setArch] = useState('Both'), [reset, setReset] = useState(0)
  const fallback = useRef(onFallback)
  fallback.current = onFallback
  return <div className="od-model">
    <div className="od-model-controls"><label>Arch <select aria-label="Arch" value={arch} onChange={e => setArch(e.target.value)}>
      {['Both','Upper','Lower'].map(a => <option key={a}>{a}</option>)}
    </select></label><button type="button" onClick={() => { setArch('Both'); setReset(n => n + 1) }}>Reset view</button></div>
    <div className="od-model-stage">
      <Canvas frameloop="demand" dpr={[1, 1.5]} camera={{ fov: 43, near: .1, far: 40 }}
        gl={{ antialias: true, powerPreference: 'low-power', alpha: true }}>
        <hemisphereLight args={['#fff9f0', '#aaa7a1', 1.45]}/>
        <directionalLight position={[-4, 6, 8]} intensity={2.1}/>
        <directionalLight position={[4, -3, -1]} intensity={1.1}/>
        <Camera reset={reset} fallback={fallback}/>
        {arch !== 'Lower' && <Gingiva primary={Number(teeth[0][0]) > 4} upper/>}
        {arch !== 'Upper' && <Gingiva primary={Number(teeth[0][0]) > 4} upper={false}/>}
        <Teeth teeth={teeth} selected={selected} current={current} onSelect={onSelect} arch={arch}/>
      </Canvas>
    </div>
    <small>Drag to rotate. Pinch or scroll to zoom. Blue marks your selection, amber marks a recorded finding, and translucent teeth indicate a documented absence.</small>
  </div>
}
