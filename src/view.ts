// Views, angles and cameras: how a render is framed. See
// docs/views-and-cameras.md in bedrock-skin-go.

import { SkinError } from './errors'
import { toLower } from './strings'

// View is which part of the model to render. Bones are included by ancestry
// rather than from a fixed list, so a custom skin's extra bones (ears,
// tails, wings, party hats) come along as long as they are parented
// somewhere under a standard anchor.
//
//   body:   the full figure
//   chest:  waist up, arms included
//   head:   the head and everything parented under it: hat, ears, horns
//   avatar: a square head icon, framed closer than head
export type View = 'body' | 'chest' | 'head' | 'avatar'

// Angle is one of the two named camera presets: front is straight on; iso
// the angled three-quarter look, front, top and one side at once. A Camera
// bypasses them with an explicit yaw and pitch.
export type Angle = 'front' | 'iso'

// Camera positions the view explicitly, instead of letting the view and
// angle pick a framing.
export interface Camera {
  // yaw turns the camera around the vertical axis, in degrees. 0 is straight
  // on; positive values bring more of the subject's left side into view.
  yaw?: number
  // pitch raises the camera, in degrees. Positive values look down.
  pitch?: number
  // fov is the field of view in degrees. 0 or unset means 35.
  fov?: number
  // margin is how much room to leave around the subject. 0 or unset means
  // 1.5; 1.0 frames as tightly as possible without clipping.
  margin?: number
}

// parseView resolves a view name, as it would arrive in a query string or a
// config file. Matching ignores case and surrounding space, and blank input
// is body. An unrecognised name is an error rather than a silent fallback,
// so a request for "avatr" is an error, not a full body.
export function parseView(raw: string): View {
  const v = toLower(raw.trim())
  if (v === '') return 'body'
  if (v === 'body' || v === 'chest' || v === 'head' || v === 'avatar') return v
  throw new SkinError('UNKNOWN_VIEW', `unknown view ${JSON.stringify(raw)}`)
}

// parseAngle resolves an angle name the way parseView resolves a view.
// Blank input is undefined, which a render reads as the default for the
// chosen view.
export function parseAngle(raw: string): Angle | undefined {
  const v = toLower(raw.trim())
  if (v === '') return undefined
  if (v === 'front' || v === 'iso') return v
  throw new SkinError('UNKNOWN_ANGLE', `unknown angle ${JSON.stringify(raw)}`)
}

// parseParts splits a comma-separated bone list into trimmed, non-empty
// names. Blank input is empty, which a render reads as "use the view".
export const parseParts = (raw: string): string[] =>
  raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
