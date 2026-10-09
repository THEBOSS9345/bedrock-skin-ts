// Every error the library throws is a SkinError with a code saying which, so
// a caller can tell bad input apart without matching on message text, as
// Node's own errors do (err.code === 'ENOENT'). Every code describes bad
// input rather than an internal failure.

export type SkinErrorCode =
  | 'NO_TEXTURE' // the texture is missing or has no pixels
  | 'NO_GEOMETRY' // the geometry held no entry that could be rendered
  | 'NO_MATCHING_PARTS' // no bone matched the parts asked for, usually a misspelled name
  | 'EMPTY_VIEW' // the view scoped to bones with nothing to draw
  | 'UNKNOWN_VIEW'
  | 'UNKNOWN_ANGLE'
  | 'UNKNOWN_MOTION'
  | 'NO_ANIMATIONS' // the animation file holds none
  | 'NO_GEOMETRY_MODELS' // valid JSON holding no geometry
  | 'JSON' // the input is not valid JSON
  | 'GEOMETRY' // valid JSON, but not geometry
  | 'ANIMATION' // an animation file could not be read
  | 'RESOURCE_PATCH' // a resource patch could not be read
  | 'IMAGE' // the bytes are not an image this library reads
  | 'PIXELS' // raw pixel data did not match its dimensions
  | 'ENCODE' // encoding the output failed

export class SkinError extends Error {
  constructor(
    readonly code: SkinErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`bedrock-skin: ${message}`, options)
    this.name = 'SkinError'
  }
}
