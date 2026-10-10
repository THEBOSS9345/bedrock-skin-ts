# bedrock-skin-viewer

**A drop-in 3D viewer for Minecraft Bedrock skins.** Drag to turn, scroll or pinch to zoom, Minecraft's own animations and Blockbench files, armor, elytra, held items, capes, custom models and persona skins. Plain HTML, React, Vue, Svelte, Angular - anything that makes a web page.

<p align="center">
  <img src="https://raw.githubusercontent.com/THEBOSS9345/bedrock-skin-ts/main/docs/images/walk.gif" width="160" alt="A skin walking">
  <img src="https://raw.githubusercontent.com/THEBOSS9345/bedrock-skin-ts/main/docs/images/dance.gif" width="160" alt="A skin dancing">
</p>

```bash
npm install bedrock-skin-viewer
```

The model is drawn by [bedrock-skin](https://www.npmjs.com/package/bedrock-skin) - the same pixels as its Go and Rust versions - in a Web Worker, so the page never stutters, however many viewers it shows. No WebGL, no three.js: a canvas.

## Quick start

**HTML, or any framework** - a custom element:

```html
<script type="module">
  import 'bedrock-skin-viewer/element'
</script>

<bedrock-skin-viewer src="skin.png" animation="walk" auto-rotate></bedrock-skin-viewer>
```

**React:**

```tsx
import { SkinViewer } from 'bedrock-skin-viewer/react'

<SkinViewer skin="/skin.png" animation="walk" autoRotate style={{ width: 300, height: 400 }} />
```

**Plain JavaScript** - in any element, under your control:

```js
import { SkinViewer } from 'bedrock-skin-viewer'

const viewer = new SkinViewer(document.querySelector('#skin'), { skin: 'skin.png', animation: 'walk' })
viewer.setView('back', { duration: 400 })
```

All three are the same viewer: everything below works in each.

## The skin

A skin is an image, or everything a player wears:

```js
viewer.setSkin({
  texture: 'skin.png',            // the skin image
  geometry: 'geometry.json',      // a custom 3D model; left out, the standard body
  model: 'slim',                  // 'wide' or 'slim', or a model's identifier
  cape: 'cape.png',
  armor: { layer1: 'diamond_1.png', layer2: 'diamond_2.png' },   // a full set
  rightHand: 'diamond_sword.png',
  leftHand: { item: 'bread.png', flat: true },
  scale: { parts: { head: 1.5 } },
})
```

| Field | What it is |
| --- | --- |
| `texture` | The skin image. |
| `geometry` | A custom model (geometry.json). |
| `model` | `'wide'` (Steve) or `'slim'` (Alex), or the identifier of the model entry to draw. |
| `resourcePatch` | The skin's resource patch, as the game sends it; it names the model. |
| `cape` | A cape image. |
| `face` | A persona skin's face image, which textures its head. `animated` takes all of a persona's animation images by type. |
| `armor` | `layer1` and `layer2` for a full set from the game's two files, or `helmet`, `chestplate`, `leggings`, `boots` and `elytra` one by one. |
| `rightHand`, `leftHand` | An item's sprite, or `{ item, flat, adjust }`: `flat` holds it as food is held, `adjust` moves, turns or resizes it. |
| `scale` | `model` resizes the whole figure; `parts` any bone (`{ head: 1.5, leftArm: 0 }`). |
| `hideSkin` | Shows the equipment alone. |

**Images** can be anything you have: a URL, a `File` or `Blob` (an upload), the file's bytes, an `<img>`, a canvas, an `ImageBitmap` or `ImageData`. PNGs are read exactly as the game reads them; JPEG and WebP work too. **JSON** (models, animation files) can be a URL, its text, its bytes, or the parsed object.

Setting the same skin again does nothing, even as a new object: in React, write it inline.

Minecraft's armor and item textures belong to Mojang, so this package does not ship them: point the viewer at your resource pack's files.

## Animation

```js
viewer.setAnimation('walk')        // Minecraft's own: walk, idle, wave, sneak
viewer.setAnimation('dance')       // one of 33 bundled examples: dance, backflip, swim...
viewer.setAnimation({ file: 'my.animation.json', name: 'animation.player.salute' })  // Blockbench
viewer.setAnimation(null)          // standing still
```

`await viewer.animations()` lists the motions and examples. An animation from a file is read in the browser; a name left out plays the file's first. Not every animation suits every model: one made for another body moves bones this one lacks, and those parts of it do nothing. `viewer.info.missingBones` lists them.

`viewer.play()`, `viewer.pause()`, `viewer.speed = 0.5` and `viewer.time = 1.2` control playback.

## Camera and controls

The camera has a `yaw` (round the model: 0 is in front, 90 its left side), a `pitch` (positive looks down) and a `zoom` (1 frames the whole model, 2 is twice as close).

```js
viewer.setCamera({ yaw: 180, zoom: 1.5 }, { duration: 500 })  // smoothly
viewer.setView('left')          // 'front', 'back', 'left', 'right', 'iso'
viewer.resetCamera()
viewer.autoRotate = 20          // degrees a second; true is 30, 0 stops
```

People move it by dragging (mouse, touch, pen), with the wheel or a pinch, and with the arrow keys and `+`/`-` once it has focus; a flick glides on, and a double-click puts the camera back. Each part can be changed or turned off:

```js
new SkinViewer(el, {
  controls: {
    zoom: false,          // no wheel or pinch zoom: the page scrolls past it
    pitch: false,         // turn round only, no tilting
    rotateSpeed: 0.5,     // degrees per pixel dragged
    minZoom: 0.8, maxZoom: 2,
    minPitch: -20, maxPitch: 45,
    inertia: false,
    invert: true,
    keyboard: false,
    doubleClickReset: false,
    stopAutoRotate: false, // keep spinning after a drag
  },
})
```

`controls: false` turns them all off, for a picture that only animates.

## Options

| Option | Default | |
| --- | --- | --- |
| `skin` | none | The skin; see above. |
| `animation` | none | What moves it; see above. |
| `playing` | `true` | Whether the animation plays. |
| `speed` | `1` | Playback speed. |
| `camera` | `{ yaw: 25, pitch: 10, zoom: 1 }` | Where the camera starts, and where `resetCamera` returns it. |
| `fov` | `35` | Field of view, in degrees. |
| `autoRotate` | `false` | `true`, or degrees a second (negative turns the other way). |
| `controls` | all on | `false`, or the controls to change. |
| `fps` | `20` | The frame rate animations are prepared at. |
| `pixelRatio` | the screen's, up to 2 | Pixels drawn per CSS pixel. |
| `maxResolution` | `1024` | The largest picture drawn, in pixels square. |
| `pauseWhenHidden` | `true` | Stops drawing while off screen or in a background tab. |
| `worker` | `'auto'` | Where drawing happens; see [Workers and bundlers](#workers-and-bundlers). |
| `label` | `"Minecraft skin"` | What screen readers say. |

## Events

```js
viewer.on('load', (info) => console.log(info.frames, info.missingBones))
viewer.on('error', (err) => console.log(err.message))   // the last picture stays
viewer.on('camera', ({ yaw, pitch, zoom }) => {})
viewer.on('state', (state) => {})                        // 'empty', 'loading', 'ready', 'error'
viewer.on('frame', ({ index }) => {})
```

`on` returns a function that stops listening. `setSkin` and `setAnimation` also return promises that settle when the skin is drawing, or reject with what went wrong.

## Styling

The viewer fills the element it is given, so size it with CSS; the custom element is 300 by 300 pixels until you say otherwise. The background is transparent: put any behind it. While a skin loads the element carries `data-state="loading"`, then `ready` or `error`:

```css
bedrock-skin-viewer { width: 320px; height: 420px; background: radial-gradient(#2b3240, #14171d); border-radius: 12px; }
bedrock-skin-viewer[data-state="loading"] { opacity: 0.5; }
bedrock-skin-viewer::part(canvas) { cursor: zoom-in; }
```

The React component also takes `loading` and `fallback` to show over the viewer:

```tsx
<SkinViewer skin={url} loading={<Spinner />} fallback={(err) => <p>{err.message}</p>} />
```

## Pictures

`await viewer.snapshot(1024)` is the current picture as a PNG `Blob`, at any size: to download, share or upload.

## Frameworks

**React** (18 and up): `bedrock-skin-viewer/react`. Every option is a prop and changes in place; `cameraPosition` makes the camera controlled; `onLoad`, `onError`, `onCameraChange` and `onStateChange` are the events; the `ref` is the `SkinViewer`. It is marked `"use client"`, for frameworks with React Server Components such as Next.js's App Router.

```tsx
const viewer = useRef<SkinViewerInstance>(null)
<SkinViewer ref={viewer} skin={{ texture: file, model: 'slim' }} animation="wave" controls={{ zoom: false }} onLoad={(i) => setFrames(i.frames)} />
<button onClick={() => viewer.current?.setView('back', { duration: 400 })}>Back</button>
```

**Vue**: tell Vue the tag is a custom element, then bind attributes and properties as usual:

```js
// vite.config.js
vue({ template: { compilerOptions: { isCustomElement: (tag) => tag === 'bedrock-skin-viewer' } } })
```

```vue
<bedrock-skin-viewer :src="url" :animation="anim" @skinload="frames = $event.detail.frames" />
```

**Svelte, Solid, Lit, Angular and plain pages** use the element as any other HTML element (Angular: add `CUSTOM_ELEMENTS_SCHEMA`).

### The element

| Attribute | |
| --- | --- |
| `src`, `geometry`, `model`, `cape` | The skin, as URLs. |
| `animation` | A motion or example by name; with `animation-file`, the animation's name in that file. |
| `animation-file` | A Bedrock animation file's URL. |
| `auto-rotate` | Present to spin; a number for its speed. |
| `yaw`, `pitch`, `zoom`, `fov` | The camera. |
| `controls` | `false`, or which: `"rotate"`, `"rotate zoom keyboard"`. |
| `paused` | Present to stop the animation. |
| `speed` | Playback speed. |
| `label` | What screen readers say. |

For what attributes cannot say, set properties: `el.skin = { armor: ..., rightHand: ... }` (attributes fill in what it leaves out), `el.animation = { file, name }`, and `el.options = { ... }` for any other option. `el.viewer` is the `SkinViewer` inside. It fires `skinload`, `skinerror` and `cameramove` events. `defineSkinViewerElement('my-tag')` defines it under another name.

## Workers and bundlers

Every viewer on a page shares one Web Worker, which this package starts itself with `new Worker(new URL('./worker.js', import.meta.url))` - the form Vite, webpack 5 and Parcel recognise and bundle on their own. It is tested with Vite, in development and in production builds.

If the worker cannot start - a bundler that did not copy it, or a Content-Security-Policy without `worker-src` - the viewer draws on the page instead, and works the same. `worker: false` does that on purpose; `worker: () => new Worker(...)` uses a worker of your own, which runs `bedrock-skin-viewer/worker`.

## Performance

A frame takes 1 to 3 milliseconds, and is drawn only when the picture would change: the camera moved, the animation moved on, or the size changed. A viewer off screen, or in a background tab, draws nothing. Viewers showing the same skin load it once.

## License

[The Unlicense](LICENSE) - public domain. Part of [bedrock-skin-ts](https://github.com/THEBOSS9345/bedrock-skin-ts).
