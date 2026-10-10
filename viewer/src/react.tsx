// <SkinViewer>, for React 18 and up:
//
//   import { SkinViewer } from 'bedrock-skin-viewer/react'
//   <SkinViewer skin="/skin.png" animation="walk" autoRotate style={{ width: 300, height: 400 }} />
//
// Every SkinViewerOptions is a prop, and changing one updates the viewer in
// place: a new skin loads, a new animation plays, nothing is torn down. A
// skin passed as a new object with the same contents each render does not
// reload. The ref is the SkinViewer inside, for everything else
// (setView, snapshot, ...).

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { AnimationInfo } from './protocol'
import type { AnimationInput, Background, Camera, Controls, NameTag, SkinInput, SkinViewerOptions } from './types'
import { SkinViewer as Viewer, type ViewerState } from './viewer'

export interface SkinViewerProps extends Omit<SkinViewerOptions, 'skin' | 'animation'> {
  skin?: SkinInput | null
  animation?: AnimationInput
  // Sets the camera whenever it changes: a controlled camera. Left out, the
  // camera is the viewer's own, and `camera` from SkinViewerOptions only
  // places it at first.
  cameraPosition?: Partial<Camera>
  className?: string
  style?: CSSProperties
  // Shown over the viewer while a skin loads, and when loading fails.
  loading?: ReactNode
  fallback?: ReactNode | ((error: Error) => ReactNode)
  onLoad?: (info: AnimationInfo) => void
  onError?: (error: Error) => void
  onCameraChange?: (camera: Camera) => void
  onStateChange?: (state: ViewerState) => void
}

// The options that only take effect when the viewer starts.
type StartOptions = Pick<SkinViewerOptions, 'worker' | 'maxResolution' | 'pauseWhenHidden'>

export const SkinViewer = forwardRef<Viewer | null, SkinViewerProps>(function SkinViewer(props, ref) {
  const box = useRef<HTMLDivElement>(null)
  const [viewer, setViewer] = useState<Viewer | null>(null)
  const instance = useRef<Viewer | null>(null)
  const [state, setState] = useState<ViewerState>('empty')
  const [error, setError] = useState<Error | null>(null)
  // The latest callbacks, so a new function each render changes nothing.
  const latest = useRef(props)
  latest.current = props

  // The viewer lives as long as the component; it restarts only if an
  // option that cannot change in place does.
  const start: StartOptions = { worker: props.worker, maxResolution: props.maxResolution, pauseWhenHidden: props.pauseWhenHidden }
  useLayoutEffect(() => {
    const p = latest.current
    const v = new Viewer(box.current!, {
      ...start,
      skin: p.skin,
      animation: p.animation,
      playing: p.playing,
      speed: p.speed,
      fps: p.fps,
      camera: { ...p.camera, ...p.cameraPosition },
      fov: p.fov,
      autoRotate: p.autoRotate,
      controls: p.controls,
      pixelRatio: p.pixelRatio,
      label: p.label,
      background: p.background,
      nameTag: p.nameTag,
    })
    const off = [
      v.on('load', (i) => latest.current.onLoad?.(i)),
      v.on('error', (e) => {
        setError(e)
        latest.current.onError?.(e)
      }),
      v.on('camera', (c) => latest.current.onCameraChange?.(c)),
      v.on('state', (s) => {
        setState(s)
        if (s !== 'error') setError(null)
        latest.current.onStateChange?.(s)
      }),
    ]
    instance.current = v
    setViewer(v)
    setState(v.state)
    return () => {
      for (const f of off) f()
      v.destroy()
      instance.current = null
      setViewer(null)
    }
  }, [start.worker, start.maxResolution, start.pauseWhenHidden])

  // The ref is the viewer from the first commit, after it is made above, so
  // a parent's effects can use it straight away.
  useImperativeHandle(ref, () => instance.current as Viewer, [viewer])

  // Each prop, changed in place.
  useEffect(() => {
    viewer?.setSkin(props.skin ?? null).catch(() => {})
  }, [viewer, props.skin])
  useEffect(() => {
    viewer?.setAnimation(props.animation ?? null).catch(() => {})
  }, [viewer, props.animation])
  useEffect(() => {
    if (viewer) viewer.playing = props.playing ?? true
  }, [viewer, props.playing])
  useEffect(() => {
    if (viewer) viewer.speed = props.speed ?? 1
  }, [viewer, props.speed])
  useEffect(() => {
    if (viewer) viewer.autoRotate = props.autoRotate ?? false
  }, [viewer, props.autoRotate])
  useEffect(() => {
    if (viewer) viewer.fov = props.fov
  }, [viewer, props.fov])
  useEffect(() => {
    if (viewer) viewer.pixelRatio = props.pixelRatio
  }, [viewer, props.pixelRatio])
  useEffect(() => {
    viewer?.canvas.setAttribute('aria-label', props.label ?? 'Minecraft skin')
  }, [viewer, props.label])
  const backgroundKey = JSON.stringify(props.background ?? null)
  useEffect(() => {
    if (viewer) viewer.background = (props.background ?? null) as Background | null
  }, [viewer, backgroundKey])
  const nameTagKey = JSON.stringify(props.nameTag ?? null)
  useEffect(() => {
    if (viewer) viewer.nameTag = (props.nameTag ?? null) as NameTag | null
  }, [viewer, nameTagKey])
  const controlsKey = JSON.stringify(props.controls ?? true)
  useEffect(() => {
    viewer?.setControls((props.controls ?? true) as boolean | Partial<Controls>)
  }, [viewer, controlsKey])
  const cam = props.cameraPosition
  useEffect(() => {
    if (viewer && cam) viewer.setCamera(cam)
  }, [viewer, cam?.yaw, cam?.pitch, cam?.zoom])

  const overlay =
    state === 'loading' && props.loading !== undefined
      ? props.loading
      : state === 'error' && error && props.fallback !== undefined
        ? typeof props.fallback === 'function'
          ? props.fallback(error)
          : props.fallback
        : null

  return (
    <div ref={box} className={props.className} style={{ position: 'relative', width: props.width ?? 300, height: props.height ?? 300, ...props.style }}>
      {overlay !== null && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>{overlay}</div>
      )}
    </div>
  )
})

export type { Viewer as SkinViewerInstance, ViewerState }
export type { AnimationInfo } from './protocol'
export type { AnimationInput, ArmorInput, Background, BoneMove, Camera, Controls, CustomAnimation, HeldInput, ImageInput, JSONInput, NameTag, Skin, SkinInput, SkinViewerOptions, View } from './types'
