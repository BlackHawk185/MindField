import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { Billboard, Html, Line, OrbitControls, Stars } from '@react-three/drei'
import { Download, FileJson, Link2, Search, Sparkles, X } from 'lucide-react'
import * as THREE from 'three'
import seedDocument from '../mindfield.graph.json'
import './App.css'

type Position = [number, number, number]
type Bubble = { id: string; title: string; detail: string; color: string; position: Position }
type Connection = { id: string; from: string; to: string; label: string }
type GraphDocument = { version: '1.0'; title: string; overview: { central_question: string; pattern: string; reading_order: string[] }; relationships: Connection[]; bubbles: Bubble[] }
type VsCodeApi = { postMessage: (message: unknown) => void }
type HidDeviceLike = { productName?: string; vendorId: number; opened: boolean; open: () => Promise<void>; close: () => Promise<void>; addEventListener: (type: string, listener: (event: any) => void) => void; removeEventListener: (type: string, listener: (event: any) => void) => void }
type HidApi = { requestDevice: (options: { filters: Array<{ vendorId?: number; productId?: number; productName?: string }> }) => Promise<HidDeviceLike[]>; getDevices: () => Promise<HidDeviceLike[]> }

const vscodeApi = (window as Window & { acquireVsCodeApi?: () => VsCodeApi }).acquireVsCodeApi?.()
const webHid = (navigator as Navigator & { hid?: HidApi }).hid

function isHidBlockedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name === 'SecurityError' || /permissions policy|disallowed by/i.test(error.message)
}

function normalizeDocument(input: GraphDocument & { connections?: Connection[] }): GraphDocument {
  return {
    version: '1.0',
    title: input.title || 'Mindfield network',
    overview: input.overview ?? { central_question: 'What is this network trying to understand?', pattern: 'A connected thought network.', reading_order: ['core premise', 'relationships', 'concept details'] },
    relationships: Array.isArray(input.relationships) ? input.relationships : input.connections ?? [],
    bubbles: Array.isArray(input.bubbles) ? input.bubbles : [],
  }
}

const STORAGE_KEY = 'thought-network.graph.json'
function loadDocument(): GraphDocument {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (!saved) return normalizeDocument(seedDocument as GraphDocument)
  const parsed = normalizeDocument(JSON.parse(saved) as GraphDocument & { connections?: Connection[] })
  if (parsed.version !== '1.0' || !Array.isArray(parsed.bubbles)) throw new Error('The saved thought network document is invalid.')
  if (parsed.title === 'Shared thought network') parsed.title = 'Mindfield network'
  const seed = normalizeDocument(seedDocument as GraphDocument)
  const branchIds = ['ui-changes', 'how-to-use', 'vscode-integration', 'web-local-app']
  const additions = seed.bubbles.filter((bubble) => branchIds.includes(bubble.id) && !parsed.bubbles.some((savedBubble) => savedBubble.id === bubble.id))
  parsed.bubbles = parsed.bubbles.filter((bubble) => bubble.id !== 'fusion360-add-in')
  parsed.relationships = parsed.relationships.filter((connection) => connection.from !== 'fusion360-add-in' && connection.to !== 'fusion360-add-in')
  const connectionAdditions = seed.relationships.filter((connection) => !parsed.relationships.some((savedConnection) => savedConnection.id === connection.id) && ['core-to-ui', 'core-to-usage', 'usage-to-vscode', 'usage-to-app'].includes(connection.id))
  const core = parsed.bubbles.find((bubble) => bubble.id === 'b1')
  if (core) { core.title = 'What is Mindfield?'; core.detail = seed.bubbles[0].detail; core.color = '#27d8e6' }
  const ui = parsed.bubbles.find((bubble) => bubble.id === 'ui-changes')
  if (ui) ui.title = 'How should this feel?'
  const usage = parsed.bubbles.find((bubble) => bubble.id === 'how-to-use')
  if (usage) usage.title = 'How do we use this elsewhere?'
  parsed.bubbles.push(...additions)
  parsed.relationships.push(...connectionAdditions)
  return parsed
}

function BubbleNode({ bubble, selected, connectTarget, siblings, onSelect, onMove, onDrop, onConnect, onCandidate, onPop }: { bubble: Bubble; selected: boolean; connectTarget: boolean; siblings: Bubble[]; onSelect: () => void; onMove: (position: Position) => void; onDrop: (position: Position, originalPosition: Position) => void; onConnect: (targetId: string, originalPosition: Position) => void; onCandidate: (id: string | null) => void; onPop: () => void }) {
  const { camera, controls, gl } = useThree()
  const orbitControls = useRef<{ enabled: boolean } | null>(null)
  const drag = useRef<{ start: Position; pointer: THREE.Vector3; plane: THREE.Plane; moved: boolean } | null>(null)
  const candidate = useRef<string | null>(null)
  const suppressClickUntil = useRef(0)
  useEffect(() => {
    orbitControls.current = controls as { enabled: boolean } | null
    return () => { if (orbitControls.current) orbitControls.current.enabled = true }
  }, [controls])
  // Nearest bubble to the cursor in 2D screen space, so depth misalignment doesn't matter.
  const findCandidate = (clientX: number, clientY: number) => {
    const rect = gl.domElement.getBoundingClientRect()
    let nearestId: string | null = null
    let nearest = 64
    for (const other of siblings) {
      if (other.id === bubble.id) continue
      const ndc = new THREE.Vector3(other.position[0], other.position[1], other.position[2]).project(camera)
      if (ndc.z > 1) continue
      const sx = rect.left + (ndc.x * 0.5 + 0.5) * rect.width
      const sy = rect.top + (-ndc.y * 0.5 + 0.5) * rect.height
      const distance = Math.hypot(sx - clientX, sy - clientY)
      if (distance < nearest) { nearest = distance; nearestId = other.id }
    }
    return nearestId
  }
  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    if (event.nativeEvent.button === 2) {
      event.nativeEvent.preventDefault()
      onPop()
      return
    }
    if (event.nativeEvent.button !== 0) return
    if (orbitControls.current) orbitControls.current.enabled = false
    const normal = new THREE.Vector3()
    camera.getWorldDirection(normal)
    drag.current = { start: bubble.position, pointer: event.point.clone(), plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, event.point), moved: false }
    ;(event.target as unknown as { setPointerCapture: (pointerId: number) => void }).setPointerCapture(event.pointerId)
  }
  const handlePointerMove = (event: ThreeEvent<PointerEvent>) => {
    if (!drag.current) return
    const point = new THREE.Vector3()
    if (!event.ray.intersectPlane(drag.current.plane, point)) return
    const offset = point.clone().sub(drag.current.pointer)
    if (offset.lengthSq() > 0.002) drag.current.moved = true
    onMove([drag.current.start[0] + offset.x, drag.current.start[1] + offset.y, drag.current.start[2] + offset.z])
    if (drag.current.moved) {
      const next = findCandidate(event.nativeEvent.clientX, event.nativeEvent.clientY)
      if (next !== candidate.current) { candidate.current = next; onCandidate(next) }
    }
  }
  const handlePointerUp = (event: ThreeEvent<PointerEvent>) => {
    if (!drag.current) return
    const moved = drag.current.moved
    const originalPosition = drag.current.start
    const target = candidate.current
    drag.current = null
    candidate.current = null
    onCandidate(null)
    if (moved) suppressClickUntil.current = performance.now() + 250
    if (orbitControls.current) orbitControls.current.enabled = true
    ;(event.target as unknown as { releasePointerCapture: (pointerId: number) => void }).releasePointerCapture(event.pointerId)
    if (!moved) return
    if (target) onConnect(target, originalPosition)
    else onDrop(bubble.position, originalPosition)
  }
  const handleContextMenu = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    event.nativeEvent.preventDefault()
    onPop()
  }
  return <group position={bubble.position} onClick={(event) => { event.stopPropagation(); if (performance.now() < suppressClickUntil.current) return; if (!drag.current) onSelect() }} onDoubleClick={(event) => event.stopPropagation()} onContextMenu={handleContextMenu} onPointerDown={(event) => { if (event.nativeEvent.button === 2) { event.stopPropagation(); event.nativeEvent.preventDefault(); onPop() } }}>
    <mesh onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}><sphereGeometry args={[0.72, 32, 32]} /><meshStandardMaterial color={connectTarget ? '#7ce6b0' : selected ? '#f4d9ae' : bubble.color} roughness={0.52} metalness={0.04} emissive={connectTarget ? '#2f9d6a' : '#000000'} emissiveIntensity={connectTarget ? 0.6 : 0} /></mesh>
    <mesh scale={connectTarget ? 1.22 : 1.08}><sphereGeometry args={[0.72, 32, 32]} /><meshBasicMaterial color={connectTarget ? '#7ce6b0' : selected ? '#f1c789' : bubble.color} wireframe transparent opacity={connectTarget ? 0.4 : 0.17} /></mesh>
    <Billboard position={[0, -1.05, 0]}><Html center className="bubble-label"><span>{bubble.title}</span></Html></Billboard>
  </group>
}

function SpaceMouseController({ enabled, controlsRef }: { enabled: boolean; controlsRef: React.MutableRefObject<any> }) {
  const { camera } = useThree()
  const activeDevice = useRef<HidDeviceLike | null>(null)
  const axes = useRef({ tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0 })
  const suppressWheelUntil = useRef(0)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const handleSyntheticWheel = (event: WheelEvent) => {
      if (performance.now() < suppressWheelUntil.current) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('wheel', handleSyntheticWheel, { capture: true, passive: false })
    const clampAxis = (value: number) => Math.abs(value) < 8 ? 0 : Math.max(-1, Math.min(1, value / 350))
    const readInt16 = (bytes: Uint8Array, offset: number) => {
      const raw = bytes[offset] | (bytes[offset + 1] << 8)
      return raw >= 0x8000 ? raw - 0x10000 : raw
    }
    const applyAxes = () => {
      const controls = controlsRef.current
      if (!controls) return
      const { tx, ty, tz, rx, rz } = axes.current
      const target = controls.target as THREE.Vector3
      const offset = camera.position.clone().sub(target)
      const spherical = new THREE.Spherical().setFromVector3(offset)
      spherical.theta += rz * 0.08
      spherical.phi = THREE.MathUtils.clamp(spherical.phi + rx * 0.08, 0.05, Math.PI - 0.05)
      offset.setFromSpherical(spherical)
      const forward = camera.getWorldDirection(new THREE.Vector3())
      const right = forward.clone().cross(camera.up).normalize()
      const pan = right.multiplyScalar(-tx * 0.12).add(camera.up.clone().multiplyScalar(tz * 0.12))
      target.add(pan)
      camera.position.copy(target).add(offset)
      const distance = offset.length()
      const dollyDistance = THREE.MathUtils.clamp(distance - ty * 0.6, 5, 18)
      camera.position.copy(target).add(offset.normalize().multiplyScalar(dollyDistance))
      controls.update()
    }
    // Extension host bridge: axes arrive as postMessages because the webview cannot open HID.
    if (vscodeApi) {
      const handleMessage = (event: MessageEvent<{ type: string; axes?: typeof axes.current }>) => {
        if (event.data.type !== 'mindfield.spacemouse' || !event.data.axes) return
        const a = event.data.axes
        axes.current = { tx: clampAxis(a.tx), ty: clampAxis(a.ty), tz: clampAxis(a.tz), rx: clampAxis(a.rx), ry: clampAxis(a.ry), rz: clampAxis(a.rz) }
        // Only block the driver's synthetic wheel while dollying, so the real mouse wheel keeps working.
        if (axes.current.ty !== 0) suppressWheelUntil.current = performance.now() + 100
        applyAxes()
      }
      window.addEventListener('message', handleMessage)
      return () => {
        cancelled = true
        window.removeEventListener('message', handleMessage)
        window.removeEventListener('wheel', handleSyntheticWheel, true)
        vscodeApi.postMessage({ type: 'mindfield.spacemouse-stop' })
      }
    }
    if (!webHid) { window.removeEventListener('wheel', handleSyntheticWheel, true); return }
    const attach = async () => {
      const devices = await webHid.getDevices()
      const target = devices.find((device) => device.vendorId === 0x046d || /space/i.test(device.productName ?? '')) ?? devices[0]
      if (!target || cancelled) return
      activeDevice.current = target
      if (!target.opened) await target.open()
      const handleInput = (event: any) => {
        if (!controlsRef.current) return
        const data = event.data as DataView
        const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        const reportId = event.reportId
        if ((reportId === 1 || reportId === 2) && bytes.length >= 6) {
          const next = axes.current
          const values = [clampAxis(readInt16(bytes, 0)), clampAxis(readInt16(bytes, 2)), clampAxis(readInt16(bytes, 4))]
          if (reportId === 1) [next.tx, next.ty, next.tz] = values
          else [next.rx, next.ry, next.rz] = values
        } else {
          if (bytes.length < 12) return
          axes.current = {
            tx: clampAxis(readInt16(bytes, 0)),
            ty: clampAxis(readInt16(bytes, 2)),
            tz: clampAxis(readInt16(bytes, 4)),
            rx: clampAxis(readInt16(bytes, 6)),
            ry: clampAxis(readInt16(bytes, 8)),
            rz: clampAxis(readInt16(bytes, 10)),
          }
        }
        // Only block the driver's synthetic wheel while dollying, so the real mouse wheel keeps working.
        if (axes.current.ty !== 0) suppressWheelUntil.current = performance.now() + 100
        applyAxes()
      }
      target.addEventListener('inputreport', handleInput)
      return () => {
        target.removeEventListener('inputreport', handleInput)
        if (target.opened) void target.close()
      }
    }
    let cleanup: (() => void) | undefined
    void attach().then((result) => { cleanup = result }).catch((error) => { console.error('SpaceMouse connection failed', error) })
    return () => {
      cancelled = true
      cleanup?.()
      window.removeEventListener('wheel', handleSyntheticWheel, true)
      if (activeDevice.current?.opened) void activeDevice.current.close()
    }
  }, [camera, controlsRef, enabled])
  return null
}

function RelationshipEdge({ from, to, onDelete }: { from: Position; to: Position; onDelete: () => void }) {
  const [hovered, setHovered] = useState(false)
  const { mid, quaternion, length } = useMemo(() => {
    const start = new THREE.Vector3(from[0], from[1], from[2])
    const end = new THREE.Vector3(to[0], to[1], to[2])
    const direction = end.clone().sub(start)
    const len = direction.length()
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize())
    return { mid: start.clone().add(end).multiplyScalar(0.5).toArray() as Position, quaternion: q.toArray() as [number, number, number, number], length: len }
  }, [from, to])
  return <group>
    <Line points={[from, to]} color={hovered ? '#f4d9ae' : '#bdc9b9'} lineWidth={hovered ? 2.6 : 1.3} transparent opacity={hovered ? 0.95 : 0.65} />
    <mesh position={mid} quaternion={quaternion}
      onPointerOver={(event) => { event.stopPropagation(); setHovered(true) }}
      onPointerOut={() => setHovered(false)}
      onContextMenu={(event) => { event.stopPropagation(); event.nativeEvent.preventDefault(); setHovered(false); onDelete() }}
      onPointerDown={(event) => { if (event.nativeEvent.button === 2) { event.stopPropagation(); event.nativeEvent.preventDefault(); setHovered(false); onDelete() } }}>
      <cylinderGeometry args={[0.28, 0.28, length, 8]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  </group>
}

function GraphScene({ document, selectedId, openBubbleIds, onSelect, onMove, onDrop, onConnect, onCreate, onPop, onDeleteConnection, onCloseBubble, onUpdateBubble, onCloseLatest, spaceMouseEnabled }: { document: GraphDocument; selectedId: string | null; openBubbleIds: string[]; onSelect: (id: string) => void; onMove: (id: string, position: Position) => void; onDrop: (id: string, position: Position, originalPosition: Position) => void; onConnect: (id: string, targetId: string, originalPosition: Position) => void; onCreate: (position: Position) => void; onPop: (id: string) => void; onDeleteConnection: (id: string) => void; onCloseBubble: (id: string) => void; onUpdateBubble: (id: string, field: 'title' | 'detail' | 'color', value: string) => void; onCloseLatest: () => void; spaceMouseEnabled: boolean }) {
  const bubbleMap = useMemo(() => new Map(document.bubbles.map((bubble) => [bubble.id, bubble])), [document.bubbles])
  const backgroundPointer = useRef<{ x: number; y: number } | null>(null)
  const controlsRef = useRef<any>(null)
  const [candidateId, setCandidateId] = useState<string | null>(null)
  return <Canvas camera={{ position: [0, 0.6, 10], fov: 42 }} dpr={[1, 2]}>
    <color attach="background" args={['#080d1b']} /><ambientLight intensity={1.1} /><directionalLight position={[4, 6, 5]} intensity={2.5} color="#c8d8ff" /><directionalLight position={[-4, -2, 2]} intensity={1.2} color="#9fc5db" />
    <Stars radius={35} depth={18} count={700} factor={1.3} saturation={0} fade speed={0.18} />
    <gridHelper args={[18, 18, '#263c67', '#172744']} position={[0, -3, 0]} />
    <mesh position={[0, 0, -2]} onPointerDown={(event) => { backgroundPointer.current = { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY } }} onPointerUp={(event) => { const start = backgroundPointer.current; backgroundPointer.current = null; if (start && Math.hypot(event.nativeEvent.clientX - start.x, event.nativeEvent.clientY - start.y) < 5) onCloseLatest() }} onDoubleClick={(event) => { event.stopPropagation(); onCreate([event.point.x, event.point.y, event.point.z]) }}><planeGeometry args={[100, 100]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} /></mesh>
    {document.relationships.map((connection) => { const from = bubbleMap.get(connection.from)?.position; const to = bubbleMap.get(connection.to)?.position; return from && to ? <RelationshipEdge key={connection.id} from={from} to={to} onDelete={() => onDeleteConnection(connection.id)} /> : null })}
    {document.bubbles.map((bubble) => <BubbleNode key={bubble.id} bubble={bubble} selected={selectedId === bubble.id} connectTarget={candidateId === bubble.id} siblings={document.bubbles} onSelect={() => onSelect(bubble.id)} onMove={(position) => onMove(bubble.id, position)} onDrop={(position, originalPosition) => onDrop(bubble.id, position, originalPosition)} onConnect={(targetId, originalPosition) => onConnect(bubble.id, targetId, originalPosition)} onCandidate={setCandidateId} onPop={() => onPop(bubble.id)} />)}
    {openBubbleIds.map((id, index) => { const bubble = bubbleMap.get(id); return bubble ? <Html key={`modal-${id}`} position={bubble.position} center style={{ pointerEvents: 'auto', zIndex: 100 + index }}><BubbleModal bubble={bubble} index={index} onClose={() => onCloseBubble(id)} onUpdate={(field, value) => onUpdateBubble(id, field, value)} /></Html> : null })}
    <OrbitControls ref={controlsRef} makeDefault enableDamping dampingFactor={0.08} minDistance={5} maxDistance={18} mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }} />
    <SpaceMouseController enabled={spaceMouseEnabled} controlsRef={controlsRef} />
    <CameraGestureMode />
  </Canvas>
}

function CameraGestureMode() {
  const { controls } = useThree()
  const orbitControls = useRef<{ mouseButtons: { LEFT: number } } | null>(null)
  useEffect(() => {
    orbitControls.current = controls as { mouseButtons: { LEFT: number } } | null
    if (!orbitControls.current) return
    const setGesture = (rotate: boolean) => { if (orbitControls.current) orbitControls.current.mouseButtons.LEFT = rotate ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN }
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Control') setGesture(true) }
    const handleKeyUp = (event: KeyboardEvent) => { if (event.key === 'Control') setGesture(false) }
    const handleBlur = () => setGesture(false)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)
    return () => { window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('keyup', handleKeyUp); window.removeEventListener('blur', handleBlur); setGesture(false) }
  }, [controls])
  return null
}

function BubbleModal({ bubble, index, onClose, onUpdate }: { bubble: Bubble; index: number; onClose: () => void; onUpdate: (field: 'title' | 'detail' | 'color', value: string) => void }) {
  const [editing, setEditing] = useState<'title' | 'detail' | null>(null)
  const colorInput = useRef<HTMLInputElement>(null)
  return <section className="bubble-modal" style={{ '--modal-index': index, '--bubble-color': bubble.color } as React.CSSProperties} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { if (event.target === event.currentTarget) colorInput.current?.click() }}>
    <input ref={colorInput} className="bubble-color-picker" type="color" value={bubble.color} onChange={(event) => onUpdate('color', event.target.value)} aria-label="Change bubble color" />
    <button className="bubble-close" onClick={onClose} title="Close bubble"><X size={14} /></button>
    {editing === 'title' ? <input className="bubble-title-edit" autoFocus value={bubble.title} onChange={(event) => onUpdate('title', event.target.value)} onBlur={() => setEditing(null)} onKeyDown={(event) => { if (event.key === 'Enter') setEditing(null) }} /> : <button className="bubble-title" onClick={() => setEditing('title')}>{bubble.title || 'Untitled'}</button>}
    {editing === 'detail' ? <textarea className="bubble-detail-edit" autoFocus value={bubble.detail} onChange={(event) => onUpdate('detail', event.target.value)} onBlur={() => setEditing(null)} rows={3} /> : <button className="bubble-detail" onClick={() => setEditing('detail')}>{bubble.detail || 'Add a description'}</button>}
  </section>
}

function App() {
  const [document, setDocument] = useState<GraphDocument>(loadDocument)
  const [bridgeReady, setBridgeReady] = useState(!vscodeApi)
  const [bridgeStatus, setBridgeStatus] = useState(vscodeApi ? 'Connecting to Mindfield host...' : '')
  const [selectedId, setSelectedId] = useState<string | null>(document.bubbles[0]?.id ?? null)
  const [openBubbleIds, setOpenBubbleIds] = useState<string[]>([])
  const [connectMode, setConnectMode] = useState(false)
  const [connectFrom, setConnectFrom] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [pendingDeleteConnection, setPendingDeleteConnection] = useState<string | null>(null)
  const [showJson, setShowJson] = useState(false)
  const [showSpaceMousePrompt, setShowSpaceMousePrompt] = useState(false)
  const [spaceMouseEnabled, setSpaceMouseEnabled] = useState(false)
  const [spaceMouseDetected, setSpaceMouseDetected] = useState<HidDeviceLike | null>(null)
  const [hidBlocked, setHidBlocked] = useState(false)
  const [spaceMouseStatus, setSpaceMouseStatus] = useState(vscodeApi ? 'SpaceMouse ready' : webHid ? 'SpaceMouse ready' : 'WebHID unavailable')
  useEffect(() => {
    if (!webHid || vscodeApi) return
    let cancelled = false
    void webHid.getDevices().then((devices) => {
      if (cancelled) return
      const device = devices.find((item) => item.vendorId === 0x046d || /space|3dconnexion/i.test(item.productName ?? ''))
      if (device) {
        setSpaceMouseDetected(device)
        setSpaceMouseEnabled(true)
        setSpaceMouseStatus(device.productName ? `SpaceMouse reconnected: ${device.productName}` : 'SpaceMouse reconnected')
      }
    }).catch((error) => {
      if (cancelled) return
      if (isHidBlockedError(error)) { setHidBlocked(true); setShowSpaceMousePrompt(true); setSpaceMouseStatus('WebHID is blocked by the host permissions policy.') }
      else setSpaceMouseStatus('SpaceMouse ready')
    })
    return () => { cancelled = true }
  }, [])
  const enableSpaceMouse = async () => {
    if (vscodeApi) {
      const handleStatus = (event: MessageEvent<{ type: string; ok?: boolean; name?: string; error?: string }>) => {
        if (event.data.type !== 'mindfield.spacemouse-status') return
        window.removeEventListener('message', handleStatus)
        if (event.data.ok) {
          setSpaceMouseEnabled(true)
          setShowSpaceMousePrompt(false)
          setSpaceMouseStatus(event.data.name ?? 'SpaceMouse connected')
        } else {
          setSpaceMouseStatus(event.data.error ?? 'No SpaceMouse found.')
        }
      }
      window.addEventListener('message', handleStatus)
      vscodeApi.postMessage({ type: 'mindfield.spacemouse-start' })
      return
    }
    if (!webHid) {
      setSpaceMouseStatus('WebHID is unavailable in this browser.')
      return
    }
    try {
      const [device] = spaceMouseDetected ? [spaceMouseDetected] : await webHid.requestDevice({ filters: [{ vendorId: 0x046d }] })
      if (!device) {
        setSpaceMouseStatus('No SpaceMouse detected.')
        return
      }
      if (!device.opened) await device.open()
      setSpaceMouseEnabled(true)
      setHidBlocked(false)
      setShowSpaceMousePrompt(false)
      setSpaceMouseStatus(device.productName ? `SpaceMouse connected: ${device.productName}` : 'SpaceMouse connected')
    } catch (error) {
      if (isHidBlockedError(error)) { setHidBlocked(true); setSpaceMouseStatus('WebHID is blocked by the host permissions policy.'); return }
      setSpaceMouseStatus(error instanceof Error ? error.message : 'SpaceMouse access was denied.')
    }
  }
  useEffect(() => {
    if (!vscodeApi || !bridgeReady) return
    void enableSpaceMouse()
  }, [bridgeReady])
  useEffect(() => {
    if (!vscodeApi) return
    vscodeApi.postMessage({ type: 'mindfield.diagnostic', message: 'React app mounted' })
    vscodeApi.postMessage({ type: 'mindfield.diagnostic', message: 'webview booted' })
    const timeout = window.setTimeout(() => {
      setBridgeStatus((status) => status === 'Connecting to Mindfield host...' ? 'No graph document received from the VS Code host.' : status)
    }, 3000)
    const handleMessage = (event: MessageEvent<{ type: string; document?: GraphDocument }>) => {
      if (event.data.type !== 'mindfield.document') return
      if (!event.data.document) { setBridgeReady(true); setBridgeStatus('Host returned no graph document.'); return }
      setDocument(normalizeDocument(event.data.document))
      setBridgeReady(true)
      setBridgeStatus('')
      vscodeApi.postMessage({ type: 'mindfield.diagnostic', message: `document received (${event.data.document.bubbles.length} bubbles)` })
    }
    const handleError = (event: ErrorEvent) => vscodeApi.postMessage({ type: 'mindfield.diagnostic', message: `webview error: ${event.message}` })
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => vscodeApi.postMessage({ type: 'mindfield.diagnostic', message: `unhandled rejection: ${String(event.reason)}` })
    window.addEventListener('message', handleMessage)
    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleUnhandledRejection)
    vscodeApi.postMessage({ type: 'mindfield.request-document' })
    return () => { window.clearTimeout(timeout); window.removeEventListener('message', handleMessage); window.removeEventListener('error', handleError); window.removeEventListener('unhandledrejection', handleUnhandledRejection) }
  }, [])
  useEffect(() => {
    if (!bridgeReady) return
    if (vscodeApi) vscodeApi.postMessage({ type: 'mindfield.save-document', document })
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(document, null, 2))
  }, [document, bridgeReady])
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return
      if (event.key.toLowerCase() === 'c') { setConnectMode((value) => !value); setConnectFrom(null) }
      if (event.key === 'Escape') { setConnectMode(false); setConnectFrom(null) }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
  const openBubble = (id: string) => { setSelectedId(id); setOpenBubbleIds((current) => current.includes(id) ? current : [...current, id]) }
  const closeBubble = (id: string) => setOpenBubbleIds((current) => current.filter((item) => item !== id))
  const selectBubble = (id: string) => { if (connectMode && connectFrom && connectFrom !== id) { setDocument((current) => current.relationships.some((connection) => (connection.from === connectFrom && connection.to === id) || (connection.from === id && connection.to === connectFrom)) ? current : { ...current, relationships: [...current.relationships, { id: `c${Date.now()}`, from: connectFrom, to: id, label: 'related to' }] }); setConnectFrom(null); return }; setSelectedId(id); if (connectMode) setConnectFrom(id); else openBubble(id) }
  const updateBubble = (id: string, field: 'title' | 'detail' | 'color' | 'position', value: string | Position) => setDocument((current) => ({ ...current, bubbles: current.bubbles.map((bubble) => bubble.id === id ? { ...bubble, [field]: value } as Bubble : bubble) }))
  const createBubble = (position: Position) => { const id = `b${Date.now()}`; setDocument((current) => ({ ...current, bubbles: [...current.bubbles, { id, title: 'Untitled', detail: '', color: '#d96c4b', position }] })); openBubble(id) }
  const dropBubble = (id: string, position: Position, originalPosition: Position) => { const target = document.bubbles.find((bubble) => bubble.id !== id && Math.hypot(bubble.position[0] - position[0], bubble.position[1] - position[1], bubble.position[2] - position[2]) < 1.45); if (!target) return; setDocument((current) => ({ ...current, bubbles: current.bubbles.map((bubble) => bubble.id === id ? { ...bubble, position: originalPosition } : bubble), relationships: current.relationships.some((connection) => (connection.from === id && connection.to === target.id) || (connection.from === target.id && connection.to === id)) ? current.relationships : [...current.relationships, { id: `c${Date.now()}`, from: id, to: target.id, label: 'related to' }] })) }
  const connectBubbles = (id: string, targetId: string, originalPosition: Position) => setDocument((current) => ({ ...current, bubbles: current.bubbles.map((bubble) => bubble.id === id ? { ...bubble, position: originalPosition } : bubble), relationships: current.relationships.some((connection) => (connection.from === id && connection.to === targetId) || (connection.from === targetId && connection.to === id)) ? current.relationships : [...current.relationships, { id: `c${Date.now()}`, from: id, to: targetId, label: 'related to' }] }))
  const popBubble = (id: string) => setPendingDelete(id)
  const confirmDelete = () => { const id = pendingDelete; setPendingDelete(null); if (!id) return; setDocument((current) => ({ ...current, bubbles: current.bubbles.filter((item) => item.id !== id), relationships: current.relationships.filter((connection) => connection.from !== id && connection.to !== id) })); closeBubble(id); if (selectedId === id) setSelectedId(null) }
  const confirmDeleteConnection = () => { const id = pendingDeleteConnection; setPendingDeleteConnection(null); if (!id) return; setDocument((current) => ({ ...current, relationships: current.relationships.filter((connection) => connection.id !== id) })) }
  const exportJson = () => { const blob = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const anchor = window.document.createElement('a'); anchor.href = url; anchor.download = 'mindfield.graph.json'; anchor.click(); URL.revokeObjectURL(url) }

  return <main className="app-shell">
    {bridgeStatus && <div className="bridge-diagnostic" role="status">{bridgeStatus}</div>}
    <header className="topbar"><div className="brand"><span className="brand-mark"><Sparkles size={16} /></span><span>mind<span className="brand-accent">field</span></span><span className="beta">BETA</span></div><div className="workspace-name">{document.title} <span className="workspace-dot" /> saved to graph document</div><div className="top-actions"><button className="icon-button" title="Search"><Search size={17} /></button><button className="icon-button" title="Export graph document" onClick={exportJson}><Download size={17} /></button><button className="avatar">TM</button></div></header>
    <div className="workspace"><aside className="left-rail"><div className="rail-heading"><div><p className="eyebrow">SHARED BRAIN / 01</p><h1>Mindfield</h1></div></div><p className="rail-copy">A spatial model of ideas, questions, and context you can hand to an AI without flattening the relationships.</p><div className="rail-section"><div className="section-label"><span>In this network</span><span>{document.bubbles.length}</span></div>{document.bubbles.map((bubble) => <button key={bubble.id} className={`bubble-list-item ${selectedId === bubble.id ? 'active' : ''}`} onClick={() => openBubble(bubble.id)}><span className="mini-dot" style={{ background: bubble.color }} /><span>{bubble.title || 'Untitled'}</span></button>)}</div><div className="rail-footer"><div className="legend-row"><span className="legend-line" /> relationship</div><div className="legend-row"><span className="legend-dot" /> concept</div><div className="rail-note"><FileJson size={15} /> Auto-saved AI graph document</div></div></aside>
      <section className="canvas-area"><div className="canvas-header"><div><p className="eyebrow">MENTAL MODEL</p><h2>Arrange the way you think.</h2></div></div><div className="scene-frame"><GraphScene document={document} selectedId={selectedId} openBubbleIds={openBubbleIds} onSelect={selectBubble} onMove={(id, position) => updateBubble(id, 'position', position)} onDrop={dropBubble} onConnect={connectBubbles} onCreate={createBubble} onPop={popBubble} onDeleteConnection={setPendingDeleteConnection} onCloseBubble={closeBubble} onUpdateBubble={updateBubble} onCloseLatest={() => closeBubble(openBubbleIds[openBubbleIds.length - 1] ?? '')} spaceMouseEnabled={spaceMouseEnabled} /><div className="scene-hint"><span className="hint-key">DRAG</span> pan <span className="hint-key">CTRL</span> rotate <span className="hint-key">DOUBLE-CLICK</span> add</div>{connectMode && <div className="connect-toast"><Link2 size={15} /> {connectFrom ? 'Select another bubble to connect' : 'Select a starting bubble'} <span className="key-dismiss">ESC</span></div>}</div><div className="canvas-footer"><span><span className="live-dot" /> Saved</span><span>{document.relationships.length} relationships</span><span>{document.bubbles.length} concepts</span>{spaceMouseDetected && !spaceMouseEnabled && <span role="status">{spaceMouseStatus}</span>}{vscodeApi && !spaceMouseEnabled && spaceMouseStatus !== 'SpaceMouse ready' && <span role="status">{spaceMouseStatus}</span>}<button onClick={() => vscodeApi ? void enableSpaceMouse() : setShowSpaceMousePrompt(true)} className="spacemouse-toggle" title={spaceMouseStatus} disabled={vscodeApi && spaceMouseEnabled}>{spaceMouseEnabled ? 'SpaceMouse active' : vscodeApi ? 'Retry SpaceMouse' : 'Enable SpaceMouse'}</button><button onClick={() => setShowJson(true)}><FileJson size={14} /> Graph document</button></div></section>
    </div>
    {showSpaceMousePrompt && !spaceMouseEnabled && <div className="modal-backdrop" onClick={() => setShowSpaceMousePrompt(false)}><div className="device-modal" role="dialog" aria-modal="true" aria-labelledby="spacemouse-title" onClick={(event) => event.stopPropagation()}><button className="icon-button subtle device-modal-close" onClick={() => setShowSpaceMousePrompt(false)} aria-label="Close SpaceMouse prompt"><X size={17} /></button><p className="eyebrow">3Dconnexion input</p>{hidBlocked ? <><h2 id="spacemouse-title">WebHID is blocked here</h2><p>The VS Code webview blocks WebHID via its iframe permissions policy, so the SpaceMouse cannot be reached. This requires a one-time local patch of the VS Code workbench to add <code>hid</code> to the webview iframe <code>allow</code> list.</p><p>Patch (PowerShell), then fully restart VS Code:</p><pre className="device-modal-patch">{'$f = Get-ChildItem "$env:LOCALAPPDATA\\Programs\\Microsoft VS Code\\*\\resources\\app\\out\\vs\\workbench\\workbench.desktop.main.js" | Sort LastWriteTime -Desc | Select -First 1 -Exp FullName\n$t = [IO.File]::ReadAllText($f)\nif (-not (Test-Path "$f.bak")) { Copy-Item $f "$f.bak" }\n[IO.File]::WriteAllText($f, $t.Replace(\'["cross-origin-isolated","autoplay","local-network-access"]\',\'["cross-origin-isolated","autoplay","local-network-access","hid"]\'), [Text.UTF8Encoding]::new($false))'}</pre></> : <><h2 id="spacemouse-title">{spaceMouseDetected ? 'SpaceMouse detected' : 'Enable SpaceMouse'}</h2><p>{spaceMouseDetected ? `${spaceMouseDetected.productName ?? 'A compatible SpaceMouse'} is available. Enable it for graph navigation?` : vscodeApi ? 'Connect your SpaceMouse for graph navigation. The VS Code host reads it directly — no browser permission dialog needed.' : 'Allow this app to access your SpaceMouse for graph navigation. Chrome will show its device permission dialog next.'}</p><button className="add-button" onClick={enableSpaceMouse}>Enable SpaceMouse</button></>}</div></div>}
    {showJson && <div className="modal-backdrop" onClick={() => setShowJson(false)}><div className="json-modal" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><p className="eyebrow">AI CONTEXT / GRAPH DOCUMENT</p><h2>Shared thought network</h2></div><button className="icon-button subtle" onClick={() => setShowJson(false)}><X size={17} /></button></div><pre>{JSON.stringify(document, null, 2)}</pre><button className="add-button" onClick={exportJson}><Download size={15} /> Download graph document</button></div></div>}
    {pendingDelete && <div className="modal-backdrop" onClick={() => setPendingDelete(null)}><div className="device-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title" onClick={(event) => event.stopPropagation()}><p className="eyebrow">Delete concept</p><h2 id="delete-title">Delete "{document.bubbles.find((item) => item.id === pendingDelete)?.title || 'Untitled'}"?</h2><p>This removes the bubble and every relationship connected to it. This cannot be undone.</p><div className="modal-actions"><button className="ghost-button" onClick={() => setPendingDelete(null)}>Cancel</button><button className="add-button danger" onClick={confirmDelete}>Delete</button></div></div></div>}
    {pendingDeleteConnection && <div className="modal-backdrop" onClick={() => setPendingDeleteConnection(null)}><div className="device-modal" role="dialog" aria-modal="true" aria-labelledby="delete-connection-title" onClick={(event) => event.stopPropagation()}><p className="eyebrow">Delete relationship</p><h2 id="delete-connection-title">Remove this connection?</h2><p>This deletes the relationship between the two concepts. The concepts themselves stay.</p><div className="modal-actions"><button className="ghost-button" onClick={() => setPendingDeleteConnection(null)}>Cancel</button><button className="add-button danger" onClick={confirmDeleteConnection}>Delete</button></div></div></div>}
  </main>
}

export default App
