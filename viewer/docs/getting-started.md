# Getting started

bedrock-skin-viewer puts a Minecraft Bedrock skin in 3D on any web page. Pick the way in that suits your page; they are all the same viewer.

- [A plain page, no build step](#a-plain-page-no-build-step)
- [With a bundler](#with-a-bundler) (Vite, webpack, Parcel, Next.js...)
- [React](#react)
- [Vue](#vue)
- [Svelte](#svelte)
- [Angular](#angular)
- [Plain JavaScript, full control](#plain-javascript-full-control)
- [Sizing it](#sizing-it)

## A plain page, no build step

One script tag, from a CDN, and the element:

```html
<script src="https://cdn.jsdelivr.net/npm/bedrock-skin-viewer"></script>

<bedrock-skin-viewer src="skin.png" animation="walk" auto-rotate name-tag="Steve"></bedrock-skin-viewer>
```

That file is everything: bedrock-skin, the viewer, and its Web Worker's code. It defines `<bedrock-skin-viewer>` and puts the whole API on `window.BedrockSkinViewer`:

```html
<div id="skin" style="width: 300px; height: 400px"></div>
<script>
  const { SkinViewer } = BedrockSkinViewer
  new SkinViewer(document.getElementById('skin'), { skin: 'skin.png', animation: 'dance' })
</script>
```

As an ES module instead:

```html
<script type="module">
  import { SkinViewer } from 'https://cdn.jsdelivr.net/npm/bedrock-skin-viewer/dist/bedrock-skin-viewer.esm.min.js'
</script>
```

The file is about 73 kB compressed. Pin a version in production: `https://cdn.jsdelivr.net/npm/bedrock-skin-viewer@0.1.0`.

## With a bundler

```bash
npm install bedrock-skin-viewer
```

```js
import 'bedrock-skin-viewer/element'          // defines <bedrock-skin-viewer>
import { SkinViewer } from 'bedrock-skin-viewer'
```

The package starts its worker in the way Vite, webpack 5 and Parcel bundle by themselves; there is nothing to configure. If a bundler does not copy the worker, the viewer draws on the page instead and still works - see [Troubleshooting](troubleshooting.md#is-it-using-the-worker).

## React

```tsx
import { SkinViewer } from 'bedrock-skin-viewer/react'

export function Profile({ skinUrl, name }: { skinUrl: string; name: string }) {
  return <SkinViewer skin={skinUrl} animation="idle" nameTag={name} autoRotate width={280} height={380} />
}
```

Every option is a prop and changes in place. For methods, take the ref:

```tsx
import { useRef } from 'react'
import { SkinViewer, type SkinViewerInstance } from 'bedrock-skin-viewer/react'

const viewer = useRef<SkinViewerInstance>(null)
<SkinViewer ref={viewer} skin="/skin.png" />
<button onClick={() => viewer.current?.setView('back', { duration: 400 })}>Back</button>
```

Next.js (App Router): the component is marked `"use client"`, so it can sit in a server component's tree.

## Vue

Tell Vue the tag is a custom element:

```js
// vite.config.js
import vue from '@vitejs/plugin-vue'
export default { plugins: [vue({ template: { compilerOptions: { isCustomElement: (tag) => tag === 'bedrock-skin-viewer' } } })] }
```

```vue
<script setup>
import 'bedrock-skin-viewer/element'
import { ref } from 'vue'
const animation = ref('walk')
</script>

<template>
  <bedrock-skin-viewer src="/skin.png" :animation="animation" auto-rotate @skinload="console.log($event.detail)" />
</template>
```

Vue sets the element's properties where it has them, so `:skin="{ texture: url, model: 'slim' }"` passes a whole skin.

## Svelte

```svelte
<script>
  import 'bedrock-skin-viewer/element'
  export let skin
</script>

<bedrock-skin-viewer src={skin} animation="wave" on:skinload={(e) => console.log(e.detail.frames)} />
```

## Angular

```ts
import { CUSTOM_ELEMENTS_SCHEMA, Component } from '@angular/core'
import 'bedrock-skin-viewer/element'

@Component({
  selector: 'app-skin',
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<bedrock-skin-viewer [attr.src]="skin" animation="walk"></bedrock-skin-viewer>`,
})
export class SkinComponent {
  skin = 'assets/skin.png'
}
```

## Plain JavaScript, full control

`SkinViewer` fills any element you give it:

```js
import { SkinViewer } from 'bedrock-skin-viewer'

const viewer = new SkinViewer(document.querySelector('#skin'), {
  skin: { texture: 'skin.png', model: 'slim', cape: 'cape.png' },
  animation: 'walk',
  autoRotate: true,
  nameTag: 'Alex',
  background: 'radial-gradient(#2b3240, #14171d)',
})

await viewer.loadSkin(fileFromAnInput)     // keeps the cape
viewer.animation = 'dance'
viewer.setView('back', { duration: 500 })
viewer.destroy()                           // when the page is done with it
```

## Sizing it

The viewer fills the element it is in, so give that element a size with CSS, or pass `width` and `height` (pixels, or any CSS length). The custom element is 300 by 300 pixels until you size it. The picture is square and centred; the rest of the box shows the background.

Next: [Recipes](recipes.md) for common pages, the [API reference](api.md) for everything, and [Troubleshooting](troubleshooting.md).
