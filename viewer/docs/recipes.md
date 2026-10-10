# Recipes

Short answers for common pages. Each uses the custom element or the `SkinViewer` class; the React component takes the same things as props.

- [Preview an upload](#preview-an-upload)
- [A player card](#a-player-card)
- [A gallery of many skins](#a-gallery-of-many-skins)
- [Skins from a Minecraft server or proxy](#skins-from-a-minecraft-server-or-proxy)
- [Armor and items from a resource pack](#armor-and-items-from-a-resource-pack)
- [Your own animation, in code](#your-own-animation-in-code)
- [An animation from Blockbench](#an-animation-from-blockbench)
- [A picture that only animates](#a-picture-that-only-animates)
- [Save or share a picture](#save-or-share-a-picture)
- [Follow the camera](#follow-the-camera)
- [Backgrounds](#backgrounds)
- [A loading state](#a-loading-state)

## Preview an upload

```html
<input type="file" id="file" accept="image/png" />
<bedrock-skin-viewer id="preview" animation="idle"></bedrock-skin-viewer>
<script>
  file.onchange = () => (preview.skin = file.files[0])
</script>
```

A `File` goes straight in; nothing is uploaded. Let people pick the arm width:

```js
preview.viewer.loadSkin(file.files[0], { model: slimCheckbox.checked ? 'slim' : 'wide' })
```

## A player card

```html
<bedrock-skin-viewer src="/skins/steve.png" name-tag="Steve" animation="idle" controls="false" auto-rotate="15"
  background="linear-gradient(#1d2433, #0e1118)" width="220" height="300"></bedrock-skin-viewer>
```

`controls="false"` leaves the page's scrolling alone; the model just turns.

## A gallery of many skins

Many viewers on one page share one worker and draw only while on screen, so a grid of them is fine:

```js
for (const url of skinUrls) {
  const v = document.createElement('bedrock-skin-viewer')
  v.setAttribute('src', url)
  v.setAttribute('controls', 'false')
  v.style.cssText = 'width: 120px; height: 160px'
  grid.append(v)
}
```

For hundreds, consider a still image per skin and a viewer only for the one opened: [bedrock-skin](https://www.npmjs.com/package/bedrock-skin)'s `renderPNG` draws stills, on a server or in the browser.

## Skins from a Minecraft server or proxy

A client sends its skin as raw RGBA with its size, its model as JSON (`null` for the standard body), and a resource patch naming the model. Pass them as they are:

```js
viewer.setSkin({
  texture: { width: skin.skinWidth, height: skin.skinHeight, data: skin.skinData },
  geometry: skin.geometry,            // 'null', or the model's JSON
  resourcePatch: skin.resourcePatch,  // names wide, slim or a custom model
  cape: skin.capeData.length ? { width: skin.capeWidth, height: skin.capeHeight, data: skin.capeData } : undefined,
  face: personaFace,                  // a persona skin's face animation image, if it has one
})
```

## Armor and items from a resource pack

Minecraft's textures belong to Mojang, so the viewer ships none: serve them from your resource pack.

```js
viewer.loadArmor({ layer1: '/pack/textures/models/armor/diamond_1.png', layer2: '/pack/textures/models/armor/diamond_2.png' })
viewer.loadItem('right', '/pack/textures/items/diamond_sword.png')
viewer.loadItem('left', { item: '/pack/textures/items/bread.png', flat: true })
viewer.loadArmor({ elytra: '/pack/textures/models/armor/elytra.png' })
```

Pieces mix: `{ helmet: gold1, chestplate: diamond1, leggings: iron2 }`. `null` takes them off.

## Your own animation, in code

```js
viewer.animation = {
  duration: 2,                       // seconds in one loop
  pose: (t) => {
    const swing = Math.sin((t / 2) * Math.PI * 2)
    return {
      rightArm: { rotation: [-swing * 60, 0, 0] },
      leftArm: { rotation: [swing * 60, 0, 0] },
      head: { rotation: [0, swing * 20, 0] },
      body: { position: [0, Math.abs(swing), 0] },
    }
  },
}
```

Bones are named as in the model: `head`, `body`, `rightArm`, `leftArm`, `rightLeg`, `leftLeg`, and a custom model's own. Rotations are degrees (a positive x tips a bone's top forward), positions model units (16 to a block), `scale` a factor (`0` hides a bone). `pose` runs once per frame when the animation is set, not while it plays.

## An animation from Blockbench

Export it (File > Export > Export Animations), then:

```js
viewer.setAnimation({ file: '/animations/salute.animation.json', name: 'animation.player.salute' })
// or one the person chose:
viewer.setAnimation({ file: input.files[0] })   // the file's first animation
```

`viewer.info.fileAnimations` lists the file's animations, and `viewer.info.missingBones` the bones it moves that this model lacks.

## A picture that only animates

```html
<bedrock-skin-viewer src="skin.png" animation="wave" controls="false" yaw="20" pitch="5"></bedrock-skin-viewer>
```

## Save or share a picture

```js
const png = await viewer.snapshot(1024)      // a Blob, the model on a transparent background
const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(png), download: 'skin.png' })
a.click()
// or: navigator.share({ files: [new File([png], 'skin.png', { type: 'image/png' })] })
```

## Follow the camera

```js
viewer.on('camera', ({ yaw, pitch, zoom }) => (angle.textContent = `${Math.round(yaw)}°`))
```

In React, `cameraPosition` makes the camera controlled - set from state, reported by `onCameraChange`.

## Backgrounds

```js
viewer.background = '#202530'                                   // any CSS background
viewer.background = 'linear-gradient(#8fc7ff, #d9efff)'
viewer.background = { image: '/backgrounds/plains.png' }        // covers the viewer
viewer.background = { panorama: '/backgrounds/sky-wide.png' }  // turns with the camera
viewer.background = null                                        // transparent
```

A panorama is a wide picture whose width is a full circle; it slides as the camera turns. Snapshots stay transparent: the background is the page's, not the picture's.

## A loading state

The element carries `data-state`: `empty`, `loading`, `ready` or `error`.

```css
bedrock-skin-viewer[data-state="loading"] { opacity: 0.5; }
bedrock-skin-viewer[data-state="error"]::after { content: 'Could not load this skin'; }
```

In React: `<SkinViewer loading={<Spinner />} fallback={(err) => <p>{err.message}</p>} />`.
