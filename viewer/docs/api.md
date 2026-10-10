# API reference

- [`SkinViewer`](#skinviewer): the viewer, in any element
- [`<bedrock-skin-viewer>`](#the-element): the custom element
- [`<SkinViewer>`](#react): the React component
- [Types](#types)

## SkinViewer

```ts
import { SkinViewer } from 'bedrock-skin-viewer'
const viewer = new SkinViewer(target: HTMLElement, options?: SkinViewerOptions)
```

`target` is the element to fill (the viewer adds a canvas to it), or a `<canvas>` to draw on.

### Options

| Option | Type | Default | |
| --- | --- | --- | --- |
| `skin` | `SkinInput \| null` | none | The skin: an image, or a [`Skin`](#skin). |
| `animation` | `AnimationInput` | still | See [`AnimationInput`](#animationinput). |
| `playing` | `boolean` | `true` | |
| `speed` | `number` | `1` | Playback speed. |
| `fps` | `number` | `20` | The rate animations are prepared at. |
| `camera` | `Partial<Camera>` | `{ yaw: 25, pitch: 10, zoom: 1 }` | The starting camera, and `resetCamera`'s. |
| `fov` | `number` | `35` | Field of view, in degrees. |
| `autoRotate` | `boolean \| number` | `false` | `true` is 30 degrees a second. |
| `controls` | `boolean \| Partial<Controls>` | all on | See [`Controls`](#controls). |
| `background` | `Background \| null` | transparent | See [`Background`](#background). |
| `nameTag` | `NameTag \| null` | none | See [`NameTag`](#nametag). |
| `width`, `height` | `number \| string` | fill the element | Pixels, or any CSS length. |
| `pixelRatio` | `number` | the screen's, up to 2 | |
| `maxResolution` | `number` | `1024` | The largest picture, in pixels square. |
| `pauseWhenHidden` | `boolean` | `true` | Draw nothing off screen or in a background tab. |
| `worker` | `'auto' \| false \| Worker \| () => Worker` | `'auto'` | Where drawing happens. |
| `label` | `string` | `"Minecraft skin"` | For screen readers. |

### Skin and animation

| | |
| --- | --- |
| `setSkin(skin): Promise<void>` | Shows a skin. Resolves when it is drawing; rejects (and fires `error`) if it cannot load. The same skin again does nothing. `null` clears. |
| `loadSkin(texture, { model?, geometry? }?)` | Another skin image, keeping the cape, armor and items. |
| `loadCape(cape \| null)` | |
| `loadArmor(armor \| null)` | See [`ArmorInput`](#armorinput). |
| `loadItem('right' \| 'left', item \| null)` | See [`HeldInput`](#heldinput). |
| `skin` | The skin as given. Setting it is `setSkin`. |
| `setAnimation(animation): Promise<void>` | Starts the animation from its beginning. |
| `animation` | Setting it is `setAnimation`. |
| `animations(): Promise<{ motions, examples }>` | The names `setAnimation` takes. |
| `info` | `{ frames, fps, missingBones, fileAnimations }` once loaded, else `null`. |
| `state` | `'empty' \| 'loading' \| 'ready' \| 'error'`. |
| `error` | Why the last load failed, or `null`. |

### Playback

| | |
| --- | --- |
| `play()`, `pause()`, `playing` | |
| `speed` | 1 is normal. |
| `time` | Seconds into the animation; settable. |

### Camera

| | |
| --- | --- |
| `camera` | `{ yaw, pitch, zoom }`. |
| `setCamera(partial, { duration? }?)` | Moves it, smoothly over `duration` milliseconds. |
| `setView(view, { duration? }?)` | `'front'`, `'back'`, `'left'`, `'right'` or `'iso'`. |
| `resetCamera({ duration? }?)` | Back to where it started. |
| `yaw`, `pitch`, `zoom`, `fov` | Each settable. |
| `autoRotate` | Degrees a second; settable to a number or `true`/`false`. |
| `controls`, `setControls(controls)` | The current controls; turn them on, off, or change some. |

### Look

| | |
| --- | --- |
| `background` | Settable; see [`Background`](#background). |
| `nameTag` | Settable; see [`NameTag`](#nametag). |
| `setSize(width?, height?)` | |
| `pixelRatio` | Settable. |
| `canvas` | The canvas drawn on. |

### Pictures, events, the end

| | |
| --- | --- |
| `snapshot(size = 512): Promise<Blob>` | The current picture as a PNG, the model alone on transparency. |
| `on(type, listener): () => void` | Listens; the returned function stops. |
| `destroy()` | Stops the viewer and removes what it added. |

| Event | Value |
| --- | --- |
| `load` | `AnimationInfo` |
| `error` | `Error` |
| `camera` | `Camera` |
| `state` | `ViewerState` |
| `frame` | `{ index }` |

The element the viewer fills carries `data-state`.

## The element

```js
import 'bedrock-skin-viewer/element'   // or the single-file script
```

| Attribute | |
| --- | --- |
| `src` | The skin image's URL. |
| `geometry` | A custom model's URL. |
| `model` | `wide`, `slim`, or an identifier. |
| `cape` | A cape's URL. |
| `animation` | A motion or example by name; with `animation-file`, a name in that file. |
| `animation-file` | A Bedrock animation file's URL. |
| `auto-rotate` | Present to spin; a number for its speed. |
| `yaw`, `pitch`, `zoom`, `fov` | The camera. |
| `controls` | `false`, or which: `rotate`, `pitch`, `zoom`, `keyboard`, `no-inertia`. |
| `paused` | Present to stop the animation. |
| `speed` | |
| `background` | Any CSS background. |
| `panorama` | A panorama's URL; it turns with the camera. |
| `name-tag` | A name above the head. |
| `width`, `height` | Numbers are pixels. |
| `label` | For screen readers. |

| Property | |
| --- | --- |
| `viewer` | The `SkinViewer` inside, while the element is on the page. |
| `skin` | A whole [`Skin`](#skin); attributes fill in what it leaves out. |
| `animation` | Any [`AnimationInput`](#animationinput); overrides the attribute. |
| `options` | Any other [option](#options), applied when it is next put on the page. |
| `info`, `camera` | As on `SkinViewer`. |

Events: `skinload` (`detail`: `AnimationInfo`), `skinerror` (`detail`: `Error`), `cameramove` (`detail`: `Camera`). CSS: `data-state` on the element, `::part(canvas)` and `::part(nametag)` inside it. `defineSkinViewerElement(tag)` defines it under another name.

## React

```tsx
import { SkinViewer, type SkinViewerInstance } from 'bedrock-skin-viewer/react'
```

Every [option](#options) is a prop, changed in place (`worker`, `maxResolution` and `pauseWhenHidden` restart it). Also:

| Prop | |
| --- | --- |
| `cameraPosition` | A controlled camera: set whenever it changes. |
| `className`, `style` | On the box the viewer fills, 300 by 300 pixels by default. |
| `loading` | Shown over the viewer while it loads. |
| `fallback` | Shown when loading fails; a node, or `(error) => node`. |
| `onLoad`, `onError`, `onCameraChange`, `onStateChange` | The events. |
| `ref` | The `SkinViewer`. |

## Types

### Skin

| Field | Type | |
| --- | --- | --- |
| `texture` | `ImageInput` | The skin image. |
| `geometry` | `JSONInput` | A custom model. |
| `model` | `string` | `'wide'`, `'slim'`, or an entry's identifier. |
| `resourcePatch` | `JSONInput` | Names the model, as the game sends it. |
| `cape` | `ImageInput` | |
| `face` | `ImageInput` | A persona skin's face image. |
| `animated` | `{ type: 1 \| 2 \| 3; texture }[]` | A persona skin's animation images, by protocol type. |
| `armor` | `ArmorInput` | |
| `rightHand`, `leftHand` | `HeldInput` | |
| `scale` | `{ model?: number; parts?: Record<string, number> }` | |
| `hideSkin` | `boolean` | The equipment alone. |

### ImageInput

A URL (`string` or `URL`), `File`/`Blob`, `ArrayBuffer` or typed array of the file, `<img>`, `<canvas>`, `OffscreenCanvas`, `ImageBitmap`, `ImageData`, or `{ width, height, data }` raw RGBA. PNGs are read exactly; JPEG and WebP by the browser.

### JSONInput

A URL, the JSON text, its bytes, a `File`/`Blob`, or the parsed object.

### ArmorInput

`{ layer1?, layer2?, helmet?, chestplate?, leggings?, boots?, elytra? }`, each an `ImageInput`. `layer1` fills helmet, chestplate and boots; `layer2` leggings; a piece named on its own wins.

### HeldInput

An `ImageInput`, or `{ item, flat?, adjust?: { offset?, rotation?, scale? } }`.

### AnimationInput

`null` or `''` (still), a motion (`walk`, `idle`, `wave`, `sneak`, `crouch`), an example's name, `{ file: JSONInput, name? }`, or a [`CustomAnimation`](#customanimation).

### CustomAnimation

`{ duration: number; pose(time: number): Record<string, BoneMove> }`, where `BoneMove` is `{ rotation?: [x, y, z]; position?: [x, y, z]; scale?: [x, y, z] | number }`.

### Controls

| | Default | |
| --- | --- | --- |
| `rotate` | `true` | Drag to turn. |
| `pitch` | `true` | Dragging tilts too. |
| `zoom` | `true` | Wheel and pinch. |
| `keyboard` | `true` | Arrows, `+`, `-`, Home. |
| `inertia` | `true` | A flick glides on. |
| `doubleClickReset` | `true` | |
| `stopAutoRotate` | `true` | A person moving it stops the spin. |
| `rotateSpeed` | `0.3` | Degrees per pixel. |
| `zoomSpeed` | `1` | |
| `invert` | `false` | |
| `minPitch`, `maxPitch` | `-60`, `60` | |
| `minZoom`, `maxZoom` | `0.5`, `2.5` | |

### Background

A CSS background string, `{ image: string; size?: 'cover' | 'contain' }`, or `{ panorama: string }`.

### NameTag

A string, or `{ text, color?, background?, font?, size? }`.
