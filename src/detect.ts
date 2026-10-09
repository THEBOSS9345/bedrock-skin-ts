// The high-level invisibility report: Skin and SkinReport.

import type { RgbaImage } from './image'
import {
  resolved,
  STANDARD_PART_NAMES,
  validateWith,
  type GeometryInput,
  type SkinPartResult,
  type SkinVisibilityResult,
  type Thresholds,
} from './invisible'

// PartVisibility is why one body part counts as rendering or not: enough
// opaque pixels to render normally (visible), no usable opaque pixels
// (invisible), some but below the minimum fraction (suspicious), or made
// too small to see by the geometry (tiny).
export type PartVisibility = 'visible' | 'invisible' | 'suspicious' | 'tiny'

// Verdict is the overall judgement on a skin: one value with a fixed set of
// states, rather than booleans that could contradict each other.
//
//   - unknown: no analysis has been run.
//   - ok: the skin renders normally.
//   - suspicious: some standard body parts do not render, but enough do
//     that the skin is not simply invisible. Worth logging or reviewing,
//     not necessarily rejecting.
//   - invisible: nothing renders, or only a stray limb does.
export type Verdict = 'unknown' | 'ok' | 'suspicious' | 'invisible'

// PartReport is one body part after analysis.
export interface PartReport {
  // The body part or bone name (head, hat, cape, ...).
  name: string
  visibility: PartVisibility
  // The share of the part's sampled pixels that are opaque, 0 to 1.
  opaqueRatio: number
  // How many texture pixels were sampled, and how many were see-through.
  pixels: number
  transparent: number
  // Resolved from real geometry cube UVs rather than the standard layout.
  fromGeometry: boolean
}

// SkinReport is the result of analysing a skin. JSON.stringify gives the
// same shape as the Go version's, for an API: snake_case fields, the
// transparent count as transparent_pixels.
export class SkinReport {
  constructor(
    readonly verdict: Verdict,
    // How many of the standard body parts render, out of totalParts.
    // Overlays fold into the part they cover and accessories are ignored,
    // so an opaque cape cannot mask an invisible body.
    readonly visibleParts: number,
    readonly totalParts: number,
    // The standard body parts first, in a fixed order, then every other
    // bone sorted by name.
    readonly parts: readonly PartReport[],
  ) {}

  // ok reports whether the skin is acceptable. False for an unknown verdict.
  get ok(): boolean {
    return this.verdict === 'ok'
  }

  // invisibleParts are the standard body parts that do not render, in report
  // order.
  invisibleParts(): string[] {
    return this.parts.filter((p) => STANDARD_PART_NAMES.includes(p.name) && p.visibility !== 'visible').map((p) => p.name)
  }

  toJSON() {
    return {
      verdict: this.verdict,
      visible_parts: this.visibleParts,
      total_parts: this.totalParts,
      parts: this.parts.map((p) => ({
        name: p.name,
        visibility: p.visibility,
        opaque_ratio: p.opaqueRatio,
        pixels: p.pixels,
        transparent_pixels: p.transparent,
        from_geometry: p.fromGeometry,
      })),
    }
  }
}

// SkinOptions are the thresholds one Skin judges by. Unset or 0 takes the
// default.
export interface SkinOptions {
  // The share of a part's pixels that must be opaque for it to count as
  // visible. Default DEFAULT_MIN_VISIBLE_FRACTION.
  minVisibleFraction?: number
  // The size a bone must reach not to be too small to see; applies only
  // with geometry. Default DEFAULT_MIN_GEOMETRY_SIZE.
  minGeometrySize?: number
  // How many of the six standard parts must be visible for the skin not to
  // be suspicious. Default DEFAULT_MIN_VISIBLE_PARTS.
  minVisibleParts?: number
}

// Skin is a texture with its optional geometry, to ask whether its body
// parts show:
//
//   const skin = new Skin(texture)
//   if (skin.report().verdict === 'invisible') { ... }
//
// The analysis runs once, on first use, and is shared by every question.
export class Skin {
  private readonly th: Thresholds
  private cached: SkinReport | undefined

  // geometry is raw geometry.json, or undefined for a skin that sends none
  // (most).
  constructor(
    private readonly texture: RgbaImage,
    private readonly geometry?: GeometryInput,
    opts: SkinOptions = {},
  ) {
    this.th = resolved(opts)
  }

  // report is the full analysis.
  report(): SkinReport {
    this.cached ??= this.analyze()
    return this.cached
  }

  // parts is the per-part breakdown.
  parts(): readonly PartReport[] {
    return this.report().parts
  }

  // isInvisible reports whether the whole skin is effectively invisible.
  isInvisible(): boolean {
    return this.report().verdict === 'invisible'
  }

  // isSuspicious reports whether the skin is half-invisible: not wholly, but
  // several body parts are missing.
  isSuspicious(): boolean {
    return this.report().verdict === 'suspicious'
  }

  // invisibleParts are the standard body parts that do not render.
  invisibleParts(): string[] {
    return this.report().invisibleParts()
  }

  // ok reports whether the skin is acceptable: the one question most
  // callers have.
  ok(): boolean {
    return this.report().ok
  }

  private analyze(): SkinReport {
    const base = validateWith(this.texture, this.geometry, this.th)
    return new SkinReport(
      verdictOf(base),
      base.visibleParts,
      STANDARD_PART_NAMES.length,
      base.parts.map((p) => ({
        name: p.name,
        visibility: partVisibility(p, this.th),
        opaqueRatio: p.fraction,
        pixels: p.pixels,
        transparent: p.transparent,
        fromGeometry: p.fromGeo,
      })),
    )
  }
}

const verdictOf = (r: SkinVisibilityResult): Verdict => (r.isInvisible ? 'invisible' : r.suspicious ? 'suspicious' : 'ok')

// partVisibility checks tiny first: it comes from the size pass, and a tiny
// part's fraction is zeroed, so it would otherwise read as transparent.
function partVisibility(p: SkinPartResult, th: Thresholds): PartVisibility {
  if (p.tiny) return 'tiny'
  if (!p.visible) return p.fraction > 0 && p.fraction < th.minVisibleFraction ? 'suspicious' : 'invisible'
  return 'visible'
}
