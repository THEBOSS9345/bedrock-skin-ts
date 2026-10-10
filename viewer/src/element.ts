// <bedrock-skin-viewer>: the viewer as an HTML element, for plain pages and
// any framework (Vue, Svelte, Angular, Solid, React 19...). Importing this
// module defines it:
//
//   import 'bedrock-skin-viewer/element'
//   <bedrock-skin-viewer src="skin.png" animation="walk" auto-rotate></bedrock-skin-viewer>
//
// Attributes set the simple things; for the rest (armor, held items, a model
// file's object...) set the element's properties, or use .viewer, the
// SkinViewer inside it. It is 300 by 300 pixels until CSS says otherwise.

import type { AnimationInfo } from './protocol'
import { isSkin } from './sources'
import type { AnimationInput, Camera, Controls, Skin, SkinInput, SkinViewerOptions } from './types'
import { SkinViewer } from './viewer'

const ATTRIBUTES = [
  'src',
  'geometry',
  'model',
  'cape',
  'animation',
  'animation-file',
  'auto-rotate',
  'yaw',
  'pitch',
  'zoom',
  'fov',
  'controls',
  'paused',
  'speed',
  'label',
  'background',
  'panorama',
  'name-tag',
  'width',
  'height',
] as const

const STYLE = `
:host { display: inline-block; position: relative; width: 300px; height: 300px; contain: content; }
:host([hidden]) { display: none; }
canvas { display: block; width: 100%; height: 100%; object-fit: contain; outline: none; }
canvas:focus-visible { outline: 2px solid Highlight; outline-offset: -2px; }
`

// In a server render there is no HTMLElement: the class is defined against a
// stand-in, and never used there.
const Base = (typeof HTMLElement === 'undefined' ? class {} : HTMLElement) as typeof HTMLElement

const num = (v: string | null) => {
  if (v === null || v.trim() === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

// controlsAttr reads controls="false", controls="rotate zoom" (only those),
// or no attribute (all).
function controlsAttr(v: string | null): boolean | Partial<Controls> {
  if (v === null || v === '' || v === 'true') return true
  if (v === 'false' || v === 'none') return false
  const on = new Set(v.split(/[\s,]+/))
  return {
    rotate: on.has('rotate'),
    pitch: on.has('rotate') || on.has('pitch'),
    zoom: on.has('zoom'),
    keyboard: on.has('keyboard') || on.has('keys'),
    inertia: !on.has('no-inertia'),
  }
}

export class SkinViewerElement extends Base {
  static readonly observedAttributes = ATTRIBUTES

  private inner: SkinViewer | null = null
  private canvasEl: HTMLCanvasElement | null = null
  private skinValue: Skin | null = null
  private animationValue: AnimationInput | undefined
  private optionsValue: SkinViewerOptions = {}

  // viewer is the SkinViewer inside, once the element is on the page.
  get viewer(): SkinViewer | null {
    return this.inner
  }

  // skin is the whole skin, for what attributes cannot say: armor, held
  // items, a parsed model. Attributes (src, geometry, model, cape) fill in
  // what it leaves out.
  get skin(): Skin | null {
    return this.skinValue
  }
  set skin(v: SkinInput | null) {
    this.skinValue = v === null ? null : isSkin(v) ? v : { texture: v }
    this.sync()
  }

  // animation overrides the animation attribute: a file's animation, say.
  get animation(): AnimationInput | undefined {
    return this.animationValue
  }
  set animation(v: AnimationInput | undefined) {
    this.animationValue = v
    this.sync()
  }

  // options are SkinViewerOptions for the next time the element is put on the
  // page (the worker, maxResolution...). Attributes override them.
  get options(): SkinViewerOptions {
    return this.optionsValue
  }
  set options(v: SkinViewerOptions) {
    this.optionsValue = v
    if (this.inner) {
      this.disconnectedCallback()
      this.connectedCallback()
    }
  }

  // info is what the loaded animation is; see SkinViewer.info.
  get info(): AnimationInfo | null {
    return this.inner?.info ?? null
  }

  get camera(): Camera | null {
    return this.inner?.camera ?? null
  }

  connectedCallback(): void {
    if (this.inner) return
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' })
    if (!this.canvasEl) {
      const style = document.createElement('style')
      style.textContent = STYLE
      this.canvasEl = document.createElement('canvas')
      this.canvasEl.setAttribute('part', 'canvas')
      root.append(style, this.canvasEl)
    }
    const a = (n: string) => this.getAttribute(n)
    const camera: Partial<Camera> = { ...this.optionsValue.camera }
    for (const k of ['yaw', 'pitch', 'zoom'] as const) {
      const v = num(a(k))
      if (v !== undefined) camera[k] = v
    }
    this.inner = new SkinViewer(this.canvasEl, {
      ...this.optionsValue,
      camera,
      fov: num(a('fov')) ?? this.optionsValue.fov,
      autoRotate: this.hasAttribute('auto-rotate') ? (num(a('auto-rotate')) ?? true) : this.optionsValue.autoRotate,
      controls: this.hasAttribute('controls') ? controlsAttr(a('controls')) : this.optionsValue.controls,
      playing: !this.hasAttribute('paused'),
      speed: num(a('speed')) ?? this.optionsValue.speed,
      label: a('label') ?? this.optionsValue.label,
      background: this.backgroundAttr() ?? this.optionsValue.background,
      nameTag: a('name-tag') ?? this.optionsValue.nameTag,
    })
    this.sizeAttrs()
    // Events, as DOM events on the element: skinload, skinerror, cameramove.
    this.inner.on('load', (info) => this.dispatchEvent(new CustomEvent('skinload', { detail: info })))
    this.inner.on('error', (error) => this.dispatchEvent(new CustomEvent('skinerror', { detail: error })))
    this.inner.on('camera', (camera) => this.dispatchEvent(new CustomEvent('cameramove', { detail: camera })))
    // Its state, for CSS: bedrock-skin-viewer[data-state="loading"].
    this.inner.on('state', (state) => this.setAttribute('data-state', state))
    this.setAttribute('data-state', this.inner.state)
    this.sync()
  }

  disconnectedCallback(): void {
    this.inner?.destroy()
    this.inner = null
  }

  attributeChangedCallback(name: (typeof ATTRIBUTES)[number], _old: string | null, value: string | null): void {
    const v = this.inner
    if (!v) return
    switch (name) {
      case 'yaw':
      case 'pitch':
      case 'zoom': {
        const n = num(value)
        if (n !== undefined) v.setCamera({ [name]: n })
        break
      }
      case 'fov':
        v.fov = num(value)
        break
      case 'auto-rotate':
        v.autoRotate = value === null ? 0 : (num(value) ?? true)
        break
      case 'controls':
        v.setControls(value === null ? true : controlsAttr(value))
        break
      case 'paused':
        v.playing = value === null
        break
      case 'speed':
        v.speed = num(value) ?? 1
        break
      case 'label':
        v.canvas.setAttribute('aria-label', value ?? 'Minecraft skin')
        break
      case 'background':
      case 'panorama':
        v.background = this.backgroundAttr() ?? null
        break
      case 'name-tag':
        v.nameTag = value
        break
      case 'width':
      case 'height':
        this.sizeAttrs()
        break
      default:
        this.sync()
    }
  }

  // backgroundAttr reads background (any CSS background) or panorama (a
  // wide picture's URL, turning with the camera).
  private backgroundAttr() {
    const p = this.getAttribute('panorama')
    if (p) return { panorama: p }
    return this.getAttribute('background') ?? undefined
  }

  // sizeAttrs sizes the element from width and height: numbers are pixels.
  private sizeAttrs() {
    for (const k of ['width', 'height'] as const) {
      const v = this.getAttribute(k)
      if (v !== null) this.style[k] = /^\d+(\.\d+)?$/.test(v) ? `${v}px` : v
    }
  }

  // sync sends the skin and animation to the viewer: the skin property, with
  // the attributes for what it leaves out.
  private sync() {
    const v = this.inner
    if (!v) return
    const a = (n: string) => this.getAttribute(n) ?? undefined
    const s: Skin = { ...this.skinValue }
    s.texture ??= a('src')
    s.geometry ??= a('geometry')
    s.model ??= a('model')
    s.cape ??= a('cape')
    const anyTexture = s.texture !== undefined || s.hideSkin
    v.setSkin(anyTexture ? s : null).catch(() => {})
    const file = a('animation-file')
    const animation = this.animationValue !== undefined ? this.animationValue : file ? { file, name: a('animation') } : (a('animation') ?? null)
    v.setAnimation(animation).catch(() => {})
  }
}

// defineSkinViewerElement defines the element under a tag of your choosing,
// once; importing 'bedrock-skin-viewer/element' does it as
// <bedrock-skin-viewer>.
export function defineSkinViewerElement(tag = 'bedrock-skin-viewer'): void {
  if (typeof customElements === 'undefined' || customElements.get(tag)) return
  // A tag can hold one class: another tag gets a subclass of its own.
  customElements.define(tag, customElements.getName?.(SkinViewerElement) ? class extends SkinViewerElement {} : SkinViewerElement)
}

defineSkinViewerElement()

declare global {
  interface HTMLElementTagNameMap {
    'bedrock-skin-viewer': SkinViewerElement
  }
}
