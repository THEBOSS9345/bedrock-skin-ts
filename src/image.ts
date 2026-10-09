// Images: what the library reads textures from and draws into.
//
// An RgbaImage is non-premultiplied RGBA, 8 bits a channel, rows top to
// bottom: the same shape as the browser's ImageData, so either can be passed
// where the other is wanted (new ImageData(img.data, img.width, img.height)
// draws a render on a canvas).

import { SkinError } from './errors'

export interface RgbaImage {
  readonly width: number
  readonly height: number
  // width * height * 4 bytes: R, G, B, A for each pixel.
  readonly data: Uint8ClampedArray | Uint8Array
}

export function newImage(width: number, height: number): RgbaImage & { data: Uint8ClampedArray } {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

// textureFromRGBA wraps raw non-premultiplied RGBA pixels as an image, which
// is the form Bedrock sends a skin in: SkinData decodes to width*height*4
// bytes with no header, the dimensions arriving separately. A length that
// disagrees with the dimensions is an error rather than a garbled image.
// The pixels are not copied.
export function textureFromRGBA(pix: Uint8Array | Uint8ClampedArray, width: number, height: number): RgbaImage {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new SkinError('PIXELS', `invalid dimensions ${width}x${height}`)
  }
  const want = width * height * 4
  if (pix.length !== want) {
    throw new SkinError('PIXELS', `got ${pix.length} bytes of pixel data, expected ${want} for ${width}x${height}`)
  }
  return { width, height, data: pix }
}

// isEmptyImage reports whether an image has no pixels.
export const isEmptyImage = (img: RgbaImage | undefined): boolean => !img || img.width === 0 || img.height === 0
