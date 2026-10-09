// Renders the pictures in README.md from testdata/bench-skin with the built
// package. Run it from the repository root after npm run build:
// node tools/images.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { decodeImage, exampleAnimations, Motion, parseGeometry, renderGIF, renderPNG } from '../dist/index.js'

const texture = decodeImage(readFileSync('testdata/bench-skin/texture.png'))
const geometry = parseGeometry(readFileSync('testdata/bench-skin/geometry.json'))
const skin = { texture, geometry, size: 256 }

writeFileSync('docs/images/body-front.png', renderPNG(skin))
writeFileSync('docs/images/body-iso.png', renderPNG({ ...skin, angle: 'iso' }))
writeFileSync('docs/images/avatar.png', renderPNG({ ...skin, view: 'avatar', angle: 'iso' }))
writeFileSync('docs/images/walk.gif', renderGIF({ ...skin, angle: 'iso', animation: Motion.walk, fps: 12 }))
writeFileSync('docs/images/dance.gif', renderGIF({ ...skin, angle: 'iso', animation: exampleAnimations().get('animation.player.dance'), fps: 12 }))
