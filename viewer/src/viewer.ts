// SkinViewer: a Minecraft Bedrock skin in 3D, in any element on the page.
// Drag to turn it, scroll or pinch to zoom; it plays animations and wears
// armor and held items. The model is drawn by bedrock-skin, the same pixels
// as its Go and Rust versions, off the page's thread.
//
//   const viewer = new SkinViewer(document.querySelector('#skin'), { skin: 'skin.png', animation: 'walk' })
//
// Each frame is drawn only when the picture would change - the camera moved,
// the animation moved on, the size changed - and one at a time, so it keeps
// up with a drag however fast the hand.

import { backendFor, type Backend } from './backend'
import { Backdrop, Tag } from './decor'
import type { AnimationInfo, WireCamera } from './protocol'
import { isSkin, keyOf, skinKey, wireAnimation, wireSkin } from './sources'
import type { AnimationInput, ArmorInput, Background, Camera, Controls, HeldInput, ImageInput, JSONInput, NameTag, Skin, SkinInput, SkinViewerOptions, View } from './types'

// The camera's resting place: a little round to the model's left, a little
// above.
const HOME: Camera = { yaw: 25, pitch: 10, zoom: 1 }

const DEFAULT_CONTROLS: Controls = {
  rotate: true,
  pitch: true,
  zoom: true,
  keyboard: true,
  inertia: true,
  doubleClickReset: true,
  stopAutoRotate: true,
  rotateSpeed: 0.3,
  zoomSpeed: 1,
  invert: false,
  minPitch: -60,
  maxPitch: 60,
  minZoom: 0.5,
  maxZoom: 2.5,
}

const VIEWS: Record<View, { yaw: number; pitch: number }> = {
  front: { yaw: 0, pitch: 0 },
  back: { yaw: 180, pitch: 0 },
  left: { yaw: 90, pitch: 0 },
  right: { yaw: -90, pitch: 0 },
  iso: { yaw: 35, pitch: 25 },
}

// The margin round the model at zoom 1: the library's room for a body.
const BASE_MARGIN = 1.5
// A glide after a flick loses this much of its speed each 60th of a second.
const GLIDE_LOSS = 0.06

export interface SkinViewerEvents {
  // The skin and animation are loaded and drawing.
  load: AnimationInfo
  // Loading failed; the last picture stays.
  error: Error
  // The camera moved, by hand, by auto-rotation or by code.
  camera: Camera
  // A new picture is on screen.
  frame: { index: number }
  // The viewer went from empty to loading to ready, or to error.
  state: ViewerState
}

type Listener<K extends keyof SkinViewerEvents> = (value: SkinViewerEvents[K]) => void

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const wrap = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180

let viewerIds = 0

// The state a viewer element shows, for CSS: [data-state="loading"].
export type ViewerState = 'empty' | 'loading' | 'ready' | 'error'

export class SkinViewer {
  // The canvas the model is drawn on: style it, or read it.
  readonly canvas: HTMLCanvasElement
  private readonly host: HTMLElement
  private readonly ownsCanvas: boolean
  private readonly id = ++viewerIds
  private readonly backend: Backend

  private skinValue: SkinInput | null = null
  private skinKeyValue = ''
  private animationValue: AnimationInput = null
  private animKeyValue = ''
  private fps: number
  private loadSeq = 0
  private loading = false
  private loadInfo: AnimationInfo | null = null
  private lastError: Error | null = null

  private cam: Camera
  private home: Camera
  private fovValue: number | undefined
  private tween: { from: Camera; to: Camera; start: number; duration: number } | null = null
  private controlsValue: Controls | null
  private autoRotateValue: number
  private playingValue: boolean
  private speedValue: number
  private clock = 0
  private pixelRatioValue: number | undefined
  private maxResolution: number
  private pauseWhenHidden: boolean

  private raf = 0
  private last = 0
  private busy = false
  private drawn = ''
  private measured = ''
  private size = 0
  private visible = true
  private camStamp = 0
  private glide: { vx: number; vy: number } | null = null
  private pointers = new Map<number, { x: number; y: number }>()
  private pinch = 0
  private lastTap = 0
  private destroyed = false
  private listeners = new Map<keyof SkinViewerEvents, Set<(value: never) => void>>()
  private cleanup: (() => void)[] = []
  private readonly backdrop: Backdrop
  private readonly tag: Tag
  private backgroundValue: Background | null = null
  private nameTagValue: NameTag | null = null

  // target is the element to show the viewer in (it fills it), or a canvas
  // to draw on.
  constructor(target: HTMLElement, options: SkinViewerOptions = {}) {
    this.backend = backendFor(options.worker)
    this.fps = options.fps ?? 20
    this.home = { ...HOME, ...options.camera }
    this.cam = { ...this.home }
    this.fovValue = options.fov
    this.controlsValue = controlsFrom(options.controls)
    this.autoRotateValue = autoRotateFrom(options.autoRotate)
    this.playingValue = options.playing ?? true
    this.speedValue = options.speed ?? 1
    this.pixelRatioValue = options.pixelRatio
    this.maxResolution = options.maxResolution ?? 1024
    this.pauseWhenHidden = options.pauseWhenHidden ?? true

    if (target instanceof HTMLCanvasElement) {
      this.canvas = target
      this.host = target.parentElement ?? target
      this.ownsCanvas = false
    } else {
      this.canvas = document.createElement('canvas')
      Object.assign(this.canvas.style, { display: 'block', width: '100%', height: '100%', objectFit: 'contain' })
      target.appendChild(this.canvas)
      this.host = target
      this.ownsCanvas = true
    }
    this.canvas.setAttribute('role', 'img')
    this.canvas.setAttribute('aria-label', options.label ?? 'Minecraft skin')
    this.backdrop = new Backdrop(this.canvas)
    this.tag = new Tag(this.canvas, this.ownsCanvas ? this.host : (this.canvas.parentNode ?? this.host))
    this.setState('empty')
    this.setSize(options.width, options.height)
    this.listen()
    this.applyControls()
    this.background = options.background ?? null
    this.nameTag = options.nameTag ?? null

    if (options.animation !== undefined) this.animationValue = options.animation
    this.animKeyValue = this.animationKey(this.animationValue)
    if (options.skin) void this.setSkin(options.skin).catch(() => {})
    this.raf = requestAnimationFrame(this.tick)
  }

  // ---- skin and animation ----

  // setSkin shows a skin: an image, or a Skin with its model, cape, armor and
  // held items. The same skin set again does nothing. It resolves once the
  // skin is drawing, and rejects if it cannot be loaded (also an 'error'
  // event). null clears the viewer.
  async setSkin(skin: SkinInput | null): Promise<void> {
    const key = skinKey(skin)
    if (key === this.skinKeyValue) return this.pending ?? undefined
    this.skinValue = skin
    this.skinKeyValue = key
    return this.reload()
  }

  // setAnimation sets what moves the model; see AnimationInput. The
  // animation starts from its beginning.
  async setAnimation(animation: AnimationInput): Promise<void> {
    const key = this.animationKey(animation)
    if (key === this.animKeyValue) return this.pending ?? undefined
    this.animationValue = animation
    this.animKeyValue = key
    this.clock = 0
    return this.reload()
  }

  private pending: Promise<void> | null = null

  private reload(): Promise<void> {
    const seq = ++this.loadSeq
    if (!this.skinValue) {
      this.loadInfo = null
      this.loading = false
      this.clear()
      this.setState('empty')
      return Promise.resolve()
    }
    this.loading = true
    this.setState('loading')
    // What to load, and the keys that name it, taken together now: the
    // engine keeps what it loads under these keys, so a key must never travel
    // with another load's input.
    const skin = this.skinValue
    const skinKeyNow = this.skinKeyValue
    const animation = this.animationValue
    const animKeyNow = this.animKeyValue
    const p = (async () => {
      try {
        const res = await this.backend.ask({
          op: 'load',
          viewer: this.id,
          seq,
          skinKey: skinKeyNow,
          skin: await wireSkin(skin),
          animKey: animKeyNow,
          animation: wireAnimation(animation, this.fps),
          fps: this.fps,
        })
        if (seq !== this.loadSeq || this.destroyed || 'stale' in res) return
        if (!('info' in res)) return
        this.loadInfo = res.info
        this.lastError = null
        this.loading = false
        this.drawn = ''
        this.setState('ready')
        this.emit('load', res.info)
      } catch (e) {
        if (seq !== this.loadSeq || this.destroyed) return
        this.loading = false
        this.lastError = e instanceof Error ? e : new Error(String(e))
        this.setState('error')
        this.emit('error', this.lastError)
        throw this.lastError
      }
    })()
    this.pending = p
    return p
  }

  private animationKey(a: AnimationInput | undefined): string {
    return keyOf(a ?? null)
  }

  // skin is the skin shown, as it was given; setting it is setSkin.
  get skin(): SkinInput | null {
    return this.skinValue
  }
  set skin(s: SkinInput | null) {
    void this.setSkin(s).catch(() => {})
  }

  // animation is what moves the model; setting it is setAnimation.
  get animation(): AnimationInput {
    return this.animationValue
  }
  set animation(a: AnimationInput) {
    void this.setAnimation(a).catch(() => {})
  }

  // The skin as a Skin, to change one part of it.
  private get skinParts(): Skin {
    const s = this.skinValue
    return s === null ? {} : isSkin(s) ? s : { texture: s }
  }

  // loadSkin shows another skin image, keeping the cape, armor and held
  // items; give a model ('slim', 'wide') or geometry to change those too.
  loadSkin(texture: ImageInput, opts: { model?: string; geometry?: JSONInput | null } = {}): Promise<void> {
    const next: Skin = { ...this.skinParts, texture }
    if ('model' in opts) next.model = opts.model
    if ('geometry' in opts) next.geometry = opts.geometry ?? undefined
    return this.setSkin(next)
  }

  // loadCape puts a cape on, or takes it off with null.
  loadCape(cape: ImageInput | null): Promise<void> {
    return this.setSkin({ ...this.skinParts, cape: cape ?? undefined })
  }

  // loadArmor dresses the model in armor, or takes it off with null.
  loadArmor(armor: ArmorInput | null): Promise<void> {
    return this.setSkin({ ...this.skinParts, armor: armor ?? undefined })
  }

  // loadItem puts an item in a hand, or empties it with null.
  loadItem(hand: 'right' | 'left', item: HeldInput | null): Promise<void> {
    return this.setSkin({ ...this.skinParts, [hand === 'right' ? 'rightHand' : 'leftHand']: item ?? undefined })
  }

  // background is what is behind the model; see Background.
  get background(): Background | null {
    return this.backgroundValue
  }
  set background(bg: Background | null) {
    this.backgroundValue = bg
    this.backdrop.set(bg, this.cam.yaw)
  }

  // nameTag is the name above the head; see NameTag.
  get nameTag(): NameTag | null {
    return this.nameTagValue
  }
  set nameTag(t: NameTag | null) {
    this.nameTagValue = t
    this.tag.set(t)
    // Measured with the next picture.
    this.drawn = ''
    this.measured = ''
  }

  // setSize fixes the viewer's size, in CSS pixels or any CSS length; left
  // out, it fills the element it is in, sized by your CSS.
  setSize(width?: number | string, height?: number | string): void {
    const box = this.ownsCanvas ? this.host : this.canvas
    const css = (v: number | string) => (typeof v === 'number' ? `${v}px` : v)
    if (width !== undefined) box.style.width = css(width)
    if (height !== undefined) box.style.height = css(height)
    this.fit()
  }

  // info is what the loaded animation is: its frames, rate and the bones it
  // moves that the model lacks. null until a skin has loaded.
  get info(): AnimationInfo | null {
    return this.loadInfo
  }

  // error is why the last load failed, or null.
  get error(): Error | null {
    return this.lastError
  }

  // animations lists what setAnimation takes by name: Minecraft's motions
  // and the bundled examples.
  async animations(): Promise<{ motions: string[]; examples: string[] }> {
    const res = await this.backend.ask({ op: 'list', viewer: this.id })
    if (!('motions' in res)) throw new Error('unexpected answer')
    return { motions: res.motions, examples: res.examples.map((e) => e.replace(/^animation\.player\./, '')) }
  }

  // ---- playback ----

  get playing(): boolean {
    return this.playingValue
  }
  set playing(v: boolean) {
    this.playingValue = v
  }
  play(): void {
    this.playingValue = true
  }
  pause(): void {
    this.playingValue = false
  }

  // speed is how fast the animation plays: 1 normal, 0.5 half speed.
  get speed(): number {
    return this.speedValue
  }
  set speed(v: number) {
    this.speedValue = Number.isFinite(v) ? v : 1
  }

  // time is how far into the animation it is, in seconds.
  get time(): number {
    return this.clock
  }
  set time(t: number) {
    this.clock = Math.max(0, t)
  }

  // ---- camera ----

  get camera(): Camera {
    return { ...this.cam }
  }

  // setCamera moves the camera, all at once or, with a duration in
  // milliseconds, smoothly.
  setCamera(c: Partial<Camera>, opts: { duration?: number } = {}): void {
    const to = this.limit({ ...this.cam, ...c })
    if (opts.duration && opts.duration > 0) {
      // The short way round.
      to.yaw = this.cam.yaw + wrap(to.yaw - this.cam.yaw)
      this.tween = { from: { ...this.cam }, to, start: performance.now(), duration: opts.duration }
    } else {
      this.tween = null
      this.cam = to
      this.moved()
    }
    this.glide = null
  }

  // setView looks from one side: 'front', 'back', 'left', 'right' or 'iso',
  // at the current zoom.
  setView(view: View, opts: { duration?: number } = {}): void {
    this.setCamera(VIEWS[view], opts)
  }

  // resetCamera puts the camera back where it started.
  resetCamera(opts: { duration?: number } = {}): void {
    this.setCamera(this.home, opts)
  }

  get yaw(): number {
    return this.cam.yaw
  }
  set yaw(v: number) {
    this.setCamera({ yaw: v })
  }
  get pitch(): number {
    return this.cam.pitch
  }
  set pitch(v: number) {
    this.setCamera({ pitch: v })
  }
  get zoom(): number {
    return this.cam.zoom
  }
  set zoom(v: number) {
    this.setCamera({ zoom: v })
  }

  get fov(): number | undefined {
    return this.fovValue
  }
  set fov(v: number | undefined) {
    this.fovValue = v
    this.moved()
  }

  // autoRotate is the degrees a second the model turns on its own; 0 is
  // still. Set true for 30.
  get autoRotate(): number {
    return this.autoRotateValue
  }
  set autoRotate(v: number | boolean) {
    this.autoRotateValue = autoRotateFrom(v)
  }

  get controls(): Controls | null {
    return this.controlsValue && { ...this.controlsValue }
  }
  // setControls turns controls on or off (true, false) or changes some.
  setControls(c: boolean | Partial<Controls>): void {
    this.controlsValue = typeof c === 'object' ? { ...(this.controlsValue ?? DEFAULT_CONTROLS), ...c } : controlsFrom(c)
    this.cam = this.limit(this.cam)
    this.applyControls()
  }

  get pixelRatio(): number {
    return this.pixelRatioValue ?? Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 2)
  }
  set pixelRatio(v: number | undefined) {
    this.pixelRatioValue = v
    this.fit()
  }

  // ---- pictures ----

  // snapshot is the current picture as a PNG, at size pixels square
  // (default 512): to save or share.
  async snapshot(size = 512): Promise<Blob> {
    const res = await this.backend.ask({ op: 'png', viewer: this.id, i: this.frameIndex(), size, camera: this.wireCamera() })
    if (!('png' in res)) throw new Error('nothing loaded')
    return new Blob([res.png as Uint8Array<ArrayBuffer>], { type: 'image/png' })
  }

  // ---- events ----

  // on calls listener on each event of the type, and returns a function that
  // stops it.
  on<K extends keyof SkinViewerEvents>(type: K, listener: Listener<K>): () => void {
    let set = this.listeners.get(type)
    if (!set) this.listeners.set(type, (set = new Set()))
    const l = listener as (value: never) => void
    set.add(l)
    return () => void set.delete(l)
  }

  private emit<K extends keyof SkinViewerEvents>(type: K, value: SkinViewerEvents[K]) {
    for (const l of this.listeners.get(type) ?? []) {
      try {
        ;(l as Listener<K>)(value)
      } catch (e) {
        console.error(e)
      }
    }
  }

  // destroy stops the viewer and removes the canvas it made.
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    cancelAnimationFrame(this.raf)
    for (const f of this.cleanup) f()
    this.tag.remove()
    if (this.ownsCanvas) this.canvas.remove()
    else this.backdrop.set(null, 0)
    this.host.removeAttribute('data-state')
    void this.backend.ask({ op: 'drop', viewer: this.id }).catch(() => {})
  }

  // ---- inside ----

  private stateValue: ViewerState = 'empty'

  // state is where the viewer is: 'empty', 'loading', 'ready' or 'error'. The
  // element it fills carries it as data-state, for CSS:
  // [data-state="loading"] { ... }.
  get state(): ViewerState {
    return this.stateValue
  }

  private setState(s: ViewerState) {
    this.host.setAttribute('data-state', s)
    if (s === this.stateValue) return
    this.stateValue = s
    this.emit('state', s)
  }

  private clear() {
    this.canvas.getContext('2d')?.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  private limit(c: Camera): Camera {
    const k = this.controlsValue ?? DEFAULT_CONTROLS
    return {
      yaw: Number.isFinite(c.yaw) ? c.yaw : 0,
      pitch: clamp(Number.isFinite(c.pitch) ? c.pitch : 0, Math.max(-89, k.minPitch), Math.min(89, k.maxPitch)),
      zoom: clamp(Number.isFinite(c.zoom) && c.zoom > 0 ? c.zoom : 1, k.minZoom, k.maxZoom),
    }
  }

  private moved() {
    this.camStamp++
    this.backdrop.turn(this.cam.yaw)
    this.emit('camera', this.camera)
  }

  private frameIndex(): number {
    const info = this.loadInfo
    if (!info || info.frames <= 1) return 0
    return Math.floor(this.clock * info.fps) % info.frames
  }

  private wireCamera(): WireCamera {
    return { yaw: this.cam.yaw, pitch: this.cam.pitch, margin: BASE_MARGIN / this.cam.zoom, fov: this.fovValue }
  }

  // fit sizes the picture to the element: as many pixels as the screen shows,
  // in steps of 32 so a resize does not draw at every pixel.
  private fit = () => {
    const r = this.canvas.getBoundingClientRect()
    const css = Math.min(r.width, r.height)
    if (css <= 0) return
    this.size = clamp(Math.ceil((css * this.pixelRatio) / 32) * 32, 32, this.maxResolution)
  }

  private tick = (now: number) => {
    if (this.destroyed) return
    this.raf = requestAnimationFrame(this.tick)
    const dt = Math.min((now - (this.last || now)) / 1000, 0.1)
    this.last = now
    if (this.pauseWhenHidden && (!this.visible || document.hidden)) return

    if (this.tween) {
      const t = Math.min((now - this.tween.start) / this.tween.duration, 1)
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
      const { from, to } = this.tween
      this.cam = { yaw: from.yaw + (to.yaw - from.yaw) * e, pitch: from.pitch + (to.pitch - from.pitch) * e, zoom: from.zoom + (to.zoom - from.zoom) * e }
      if (t >= 1) this.tween = null
      this.moved()
    } else if (this.autoRotateValue && this.pointers.size === 0) {
      this.cam.yaw = wrap(this.cam.yaw + dt * this.autoRotateValue)
      this.moved()
    }
    if (this.glide && this.pointers.size === 0) {
      const loss = (1 - GLIDE_LOSS) ** (dt * 60)
      this.glide.vx *= loss
      this.glide.vy *= loss
      if (Math.abs(this.glide.vx) < 0.05 && Math.abs(this.glide.vy) < 0.05) this.glide = null
      else this.turn(this.glide.vx * dt * 60, this.glide.vy * dt * 60)
    }
    if (this.playingValue && this.loadInfo && this.loadInfo.frames > 1) this.clock += dt * this.speedValue
    if (this.clock < 0) this.clock = 0

    if (!this.loadInfo || this.loading || this.busy || !this.size) return
    const i = this.frameIndex()
    const want = `${this.skinKeyValue}|${this.animKeyValue}|${i}|${this.camStamp}|${this.size}`
    if (want === this.drawn) return
    this.busy = true
    const seq = this.loadSeq
    // The name tag's place changes only with the camera and the size.
    const view = `${this.skinKeyValue}|${this.animKeyValue}|${this.camStamp}|${this.size}`
    const measure = this.tag.on && view !== this.measured
    this.backend.ask({ op: 'draw', viewer: this.id, i, size: this.size, camera: this.wireCamera(), measure }).then(
      (res) => {
        this.busy = false
        if (seq !== this.loadSeq || this.destroyed || !('data' in res)) return
        this.drawn = want
        if (this.canvas.width !== res.width) this.canvas.width = res.width
        if (this.canvas.height !== res.height) this.canvas.height = res.height
        this.canvas.getContext('2d')!.putImageData(new ImageData(res.data as Uint8ClampedArray<ArrayBuffer>, res.width, res.height), 0, 0)
        if (measure) {
          this.measured = view
          this.tag.place(res.top)
        }
        this.emit('frame', { index: i })
      },
      () => {
        // Not loaded in the engine (it was replaced, say): drawn again next
        // tick once a load lands.
        this.busy = false
        this.drawn = want
      },
    )
  }

  // turn moves the camera by a drag: dx, dy in degrees.
  private turn(dx: number, dy: number) {
    const k = this.controlsValue ?? DEFAULT_CONTROLS
    // The model turns the way the hand moves: dragging right turns its front
    // to the right.
    const sign = k.invert ? 1 : -1
    this.cam = this.limit({ ...this.cam, yaw: wrap(this.cam.yaw + sign * dx), pitch: k.pitch ? this.cam.pitch + dy : this.cam.pitch })
    this.moved()
  }

  private zoomBy(factor: number) {
    this.tween = null
    this.cam = this.limit({ ...this.cam, zoom: this.cam.zoom * factor })
    this.moved()
  }

  private touched() {
    this.tween = null
    if (this.controlsValue?.stopAutoRotate) this.autoRotateValue = 0
  }

  private applyControls() {
    const k = this.controlsValue
    const s = this.canvas.style
    s.touchAction = k && (k.rotate || k.zoom) ? 'none' : ''
    s.cursor = k?.rotate ? 'grab' : ''
    if (k?.keyboard) this.canvas.tabIndex = 0
    else this.canvas.removeAttribute('tabindex')
  }

  private listen() {
    const c = this.canvas
    const on = <K extends keyof HTMLElementEventMap>(type: K, f: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      c.addEventListener(type, f as EventListener, opts)
      this.cleanup.push(() => c.removeEventListener(type, f as EventListener, opts))
    }
    on('pointerdown', (e) => {
      const k = this.controlsValue
      if (!k || (!k.rotate && !k.zoom)) return
      c.setPointerCapture(e.pointerId)
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      this.glide = null
      this.touched()
      if (k.rotate) c.style.cursor = 'grabbing'
      if (this.pointers.size === 2) this.pinch = pinchDistance(this.pointers)
      // A second tap soon after the first, in one place: reset.
      if (k.doubleClickReset && this.pointers.size === 1) {
        const now = performance.now()
        if (now - this.lastTap < 300) this.resetCamera({ duration: 300 })
        this.lastTap = now
      }
    })
    on('pointermove', (e) => {
      const k = this.controlsValue
      const p = this.pointers.get(e.pointerId)
      if (!k || !p) return
      if (this.pointers.size >= 2) {
        p.x = e.clientX
        p.y = e.clientY
        const d = pinchDistance(this.pointers)
        if (k.zoom && this.pinch > 0) this.zoomBy(d / this.pinch)
        this.pinch = d
        return
      }
      if (!k.rotate) return
      const dx = (e.clientX - p.x) * k.rotateSpeed
      const dy = (e.clientY - p.y) * k.rotateSpeed
      p.x = e.clientX
      p.y = e.clientY
      this.lastTap = 0
      this.turn(dx, dy)
      this.glide = k.inertia ? { vx: dx, vy: k.pitch ? dy : 0 } : null
    })
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId)
      if (this.pointers.size < 2) this.pinch = 0
      if (this.pointers.size === 0 && this.controlsValue?.rotate) c.style.cursor = 'grab'
      // A flick glides on; a drag that stopped before letting go does not.
      if (this.glide && Math.abs(this.glide.vx) < 0.6 && Math.abs(this.glide.vy) < 0.6) this.glide = null
    }
    on('pointerup', up)
    on('pointercancel', up)
    on(
      'wheel',
      (e) => {
        const k = this.controlsValue
        if (!k?.zoom) return
        e.preventDefault()
        this.touched()
        this.zoomBy(Math.exp(-e.deltaY * 0.0015 * k.zoomSpeed))
      },
      { passive: false },
    )
    on('keydown', (e) => {
      const k = this.controlsValue
      if (!k?.keyboard) return
      const step = e.shiftKey ? 45 : 15
      const keys: Record<string, () => void> = {
        ArrowLeft: () => k.rotate && this.setCamera({ yaw: this.cam.yaw + (k.invert ? -step : step) }, { duration: 150 }),
        ArrowRight: () => k.rotate && this.setCamera({ yaw: this.cam.yaw - (k.invert ? -step : step) }, { duration: 150 }),
        ArrowUp: () => k.pitch && this.setCamera({ pitch: this.cam.pitch - step / 3 }, { duration: 150 }),
        ArrowDown: () => k.pitch && this.setCamera({ pitch: this.cam.pitch + step / 3 }, { duration: 150 }),
        '+': () => k.zoom && this.setCamera({ zoom: this.cam.zoom * 1.2 }, { duration: 150 }),
        '=': () => k.zoom && this.setCamera({ zoom: this.cam.zoom * 1.2 }, { duration: 150 }),
        '-': () => k.zoom && this.setCamera({ zoom: this.cam.zoom / 1.2 }, { duration: 150 }),
        Home: () => this.resetCamera({ duration: 300 }),
      }
      const f = keys[e.key]
      if (!f) return
      e.preventDefault()
      this.touched()
      f()
    })

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(this.fit)
      ro.observe(c)
      this.cleanup.push(() => ro.disconnect())
    }
    if (typeof IntersectionObserver !== 'undefined') {
      const io = new IntersectionObserver((entries) => {
        this.visible = entries.some((e) => e.isIntersecting)
        this.last = 0
      })
      io.observe(c)
      this.cleanup.push(() => io.disconnect())
    }
    this.fit()
  }
}

function controlsFrom(c: boolean | Partial<Controls> | undefined): Controls | null {
  if (c === false) return null
  if (c === true || c === undefined) return { ...DEFAULT_CONTROLS }
  return { ...DEFAULT_CONTROLS, ...c }
}

function autoRotateFrom(v: boolean | number | undefined): number {
  if (v === true) return 30
  if (typeof v === 'number' && Number.isFinite(v)) return v
  return 0
}

function pinchDistance(p: Map<number, { x: number; y: number }>): number {
  const [a, b] = [...p.values()]
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
}
