// What the viewer shows round the model, drawn by the page rather than the
// engine: the background, behind the canvas, and the name tag, over it. The
// engine's pictures stay the model alone, pixel for pixel.

import { drawText } from './pixelfont'
import type { Background, NameTag } from './types'

// Backdrop paints a background behind the model. A panorama is a wide
// picture repeated across, moved as the camera turns: a full circle of yaw
// is its full width.
export class Backdrop {
  private panorama: { url: string; aspect: number } | null = null
  private loading = 0

  constructor(private readonly canvas: HTMLCanvasElement) {}

  set(bg: Background | null | undefined, yaw: number): void {
    const s = this.canvas.style
    this.panorama = null
    const seq = ++this.loading
    s.background = ''
    if (!bg) return
    if (typeof bg === 'string') {
      s.background = bg
      return
    }
    if ('image' in bg) {
      s.background = `url(${JSON.stringify(bg.image)}) center / ${bg.size ?? 'cover'} no-repeat`
      return
    }
    // A panorama's width depends on its shape, known once it loads.
    const img = new Image()
    img.onload = () => {
      if (seq !== this.loading || !img.naturalHeight) return
      this.panorama = { url: bg.panorama, aspect: img.naturalWidth / img.naturalHeight }
      s.background = `url(${JSON.stringify(bg.panorama)}) 0 0 / auto 100% repeat-x`
      this.turn(yaw)
    }
    img.src = bg.panorama
  }

  // turn moves a panorama with the camera: dragging the model right slides
  // the scenery right with it.
  turn(yaw: number): void {
    if (!this.panorama) return
    const width = this.canvas.clientHeight * this.panorama.aspect
    this.canvas.style.backgroundPositionX = `${(-yaw / 360) * width}px`
  }
}

const TAG_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'absolute',
  left: '0',
  top: '0',
  transform: 'translate(-50%, -100%)',
  pointerEvents: 'none',
  whiteSpace: 'nowrap',
  lineHeight: '0',
  zIndex: '1',
}

// Tag is the name above the head: an element over the canvas. By default it
// is drawn in Minecraft's own font, pixel for pixel, on a translucent dark
// box as in game; with a font of your own it is ordinary text, which CSS can
// style.
export class Tag {
  private el: HTMLDivElement | null = null
  private drawn = 0

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly parent: Node,
  ) {}

  get on(): boolean {
    return this.el !== null
  }

  set(tag: NameTag | null | undefined): void {
    if (!tag || (typeof tag === 'object' && !tag.text)) {
      this.remove()
      return
    }
    const t = typeof tag === 'string' ? { text: tag } : tag
    if (!this.el) {
      this.el = document.createElement('div')
      this.el.className = 'bsv-nametag'
      this.el.setAttribute('part', 'nametag')
      this.el.setAttribute('aria-hidden', 'true')
      Object.assign(this.el.style, TAG_STYLE)
      this.el.hidden = true
      // The tag is placed against the canvas's own box: its parent must be
      // positioned for that.
      const host = this.parent instanceof HTMLElement ? this.parent : null
      if (host && getComputedStyle(host).position === 'static') host.style.position = 'relative'
      this.parent.appendChild(this.el)
    }
    const el = this.el
    const color = t.color ?? '#fff'
    const background = t.background ?? 'rgba(0, 0, 0, 0.35)'
    // The text's height in CSS pixels: 8 font pixels at 2 each by default.
    const size = t.size ?? 16
    const seq = ++this.drawn
    if (t.font) {
      el.replaceChildren(t.text)
      Object.assign(el.style, { color, background, font: `${size}px ${t.font}`, padding: '1px 6px', lineHeight: '1.3' })
      return
    }
    Object.assign(el.style, { color: '', background: '', font: '', padding: '0', lineHeight: '0' })
    const c = document.createElement('canvas')
    // Whole device pixels per font pixel, so every glyph pixel is sharp.
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1
    const scale = Math.max(1, Math.round((size / 8) * dpr))
    void drawText(c, t.text, scale, color, background).then(() => {
      if (seq !== this.drawn || this.el !== el) return
      c.style.width = `${c.width / dpr}px`
      c.style.height = `${c.height / dpr}px`
      c.style.display = 'block'
      el.replaceChildren(c)
    })
  }

  // place puts the tag above a point of the picture, x and y 0..1 across it,
  // or hides it.
  place(at: { x: number; y: number } | undefined): void {
    const el = this.el
    if (!el) return
    if (!at) {
      el.hidden = true
      return
    }
    // The picture is square, centred in the canvas's box (object-fit:
    // contain).
    const c = this.canvas
    const side = Math.min(c.clientWidth, c.clientHeight)
    const left = c.offsetLeft + (c.clientWidth - side) / 2 + at.x * side
    const top = c.offsetTop + (c.clientHeight - side) / 2 + at.y * side - 4
    el.hidden = top < el.offsetHeight / 2
    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }

  remove(): void {
    this.el?.remove()
    this.el = null
  }
}
