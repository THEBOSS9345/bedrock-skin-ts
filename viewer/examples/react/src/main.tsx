import { StrictMode, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Skin, SkinViewerInstance } from 'bedrock-skin-viewer/react'
import { SkinViewer } from 'bedrock-skin-viewer/react'

// Stand-in armor and a sword, drawn here: Minecraft's own textures belong to
// Mojang, so a real site points these at its resource pack's files.
function armorTexture(tint: string): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 32
  const g = c.getContext('2d')!
  g.fillStyle = tint
  g.fillRect(0, 0, 64, 32)
  g.fillStyle = 'rgba(255,255,255,0.35)'
  for (let x = 0; x < 64; x += 4) g.fillRect(x, 0, 1, 32)
  return c
}

function swordTexture(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = 16
  const g = c.getContext('2d')!
  for (let i = 0; i < 16; i++) {
    g.fillStyle = i < 4 ? '#7a5230' : '#7ee0ff'
    g.fillRect(i, 15 - i, 2, 2)
  }
  return c
}

function App() {
  const viewer = useRef<SkinViewerInstance | null>(null)
  const [animation, setAnimation] = useState('walk')
  const [names, setNames] = useState<{ motions: string[]; examples: string[] }>({ motions: [], examples: [] })
  const [slim, setSlim] = useState(false)
  const [custom, setCustom] = useState(true)
  const [armor, setArmor] = useState(true)
  const [sword, setSword] = useState(true)
  const [spin, setSpin] = useState(true)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [zoomable, setZoomable] = useState(true)
  const [upload, setUpload] = useState<File | null>(null)
  const [log, setLog] = useState<string[]>([])
  const say = (s: string) => setLog((l) => [s, ...l].slice(0, 6))

  const textures = useMemo(() => ({ diamond: armorTexture('#3fc8c8'), legs: armorTexture('#2d8f8f'), sword: swordTexture() }), [])

  // A new object each render, on purpose: the viewer only reloads when what
  // it says changes.
  const skin: Skin = {
    texture: upload ?? '/skin.png',
    geometry: custom && !upload ? '/geometry.json' : undefined,
    model: slim ? 'slim' : undefined,
    armor: armor ? { layer1: textures.diamond, layer2: textures.legs } : undefined,
    rightHand: sword ? textures.sword : undefined,
  }

  useEffect(() => {
    viewer.current?.animations().then(setNames)
  }, [])

  const save = async () => {
    const blob = await viewer.current!.snapshot(512)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'skin.png'
    a.click()
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, display: 'grid', gridTemplateColumns: '420px 1fr', gap: 24 }}>
      <SkinViewer
        ref={viewer}
        skin={skin}
        animation={animation}
        autoRotate={spin}
        playing={playing}
        speed={speed}
        controls={{ zoom: zoomable }}
        className="viewer"
        style={{ width: 420, height: 520, background: 'radial-gradient(circle at 50% 40%, #2b3240, #14171d)', borderRadius: 12 }}
        loading={<span style={{ color: '#aab' }}>Loading skin…</span>}
        fallback={(e) => <span style={{ color: '#f88' }}>{e.message}</span>}
        onLoad={(i) => say(`loaded: ${i.frames} frame${i.frames === 1 ? "" : "s"}${i.missingBones.length ? `, missing ${i.missingBones.join(', ')}` : ''}`)}
        onError={(e) => say(`error: ${e.message}`)}
        onStateChange={(s) => document.body.setAttribute('data-viewer', s)}
      />
      <section style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
        <h1 style={{ margin: 0 }}>bedrock-skin-viewer + React</h1>
        <label>
          Animation{' '}
          <select id="anim" value={animation} onChange={(e) => setAnimation(e.target.value)}>
            <option value="">none</option>
            {names.motions.map((m) => (
              <option key={m}>{m}</option>
            ))}
            {names.examples.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label><input id="custom" type="checkbox" checked={custom} onChange={(e) => setCustom(e.target.checked)} /> custom model</label>
          <label><input id="slim" type="checkbox" checked={slim} onChange={(e) => setSlim(e.target.checked)} /> slim</label>
          <label><input id="armor" type="checkbox" checked={armor} onChange={(e) => setArmor(e.target.checked)} /> armor</label>
          <label><input id="sword" type="checkbox" checked={sword} onChange={(e) => setSword(e.target.checked)} /> sword</label>
          <label><input id="spin" type="checkbox" checked={spin} onChange={(e) => setSpin(e.target.checked)} /> auto-rotate</label>
          <label><input id="play" type="checkbox" checked={playing} onChange={(e) => setPlaying(e.target.checked)} /> playing</label>
          <label><input id="zoom" type="checkbox" checked={zoomable} onChange={(e) => setZoomable(e.target.checked)} /> wheel zoom</label>
        </div>
        <label>
          Speed <input id="speed" type="range" min={0.25} max={2} step={0.25} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} /> {speed}×
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(['front', 'back', 'left', 'right', 'iso'] as const).map((v) => (
            <button key={v} id={`view-${v}`} onClick={() => viewer.current?.setView(v, { duration: 400 })}>
              {v}
            </button>
          ))}
          <button id="reset" onClick={() => viewer.current?.resetCamera({ duration: 400 })}>reset</button>
          <button id="snapshot" onClick={save}>save PNG</button>
        </div>
        <label>
          Your own skin <input id="file" type="file" accept="image/png,image/jpeg" onChange={(e) => setUpload(e.target.files?.[0] ?? null)} />
        </label>
        <ul id="log" style={{ color: '#666', margin: 0 }}>
          {log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
        <h2>Many on one page</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {['idle', 'wave', 'sneak', 'dance'].map((a, i) => (
            <SkinViewer key={a} skin="/skin.png" animation={a} controls={false} camera={{ yaw: 20 + i * 30 }} style={{ width: 110, height: 150, background: '#1b1f27', borderRadius: 8 }} />
          ))}
        </div>
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
