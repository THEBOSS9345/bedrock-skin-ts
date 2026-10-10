# Troubleshooting

## Nothing shows

- **The element has no size.** The viewer fills its element; an element with no height draws nothing. Give it a size with CSS, or `width`/`height`. The custom element is 300 by 300 pixels by default, but a parent with `display: flex` or `grid` can still squash it.
- **The skin did not load.** Look at `data-state` on the element: `error` means it failed, and `viewer.error` (or the `error` / `skinerror` event) says why - a URL that answered 404, a file that is not an image.
- **It is off screen or in a background tab.** The viewer draws only while it can be seen (`pauseWhenHidden`); it catches up as soon as it is.

## An image from another site will not load

The viewer fetches images itself, so the other site must allow it (CORS: `Access-Control-Allow-Origin`). Serve the skin from your own site, or pass the image another way: a `Blob` you fetched, an `<img>` that loaded it, or its bytes.

## Is it using the worker?

By default every viewer draws in one shared Web Worker. If the worker cannot start, the viewer draws on the page instead and works the same, only on the page's thread. That happens when:

- **A Content-Security-Policy forbids it.** Allow `worker-src 'self'` (or `blob:` for the single-file script).
- **A bundler did not copy `worker.js`.** Vite, webpack 5 and Parcel copy it by themselves. With another, import the single-file build instead, which carries its worker's code inside: `import { SkinViewer } from 'bedrock-skin-viewer/standalone'`.

To draw on the page on purpose - in a test, say - pass `worker: false`.

## Vue warns "Failed to resolve component: bedrock-skin-viewer"

Tell Vue it is a custom element: `compilerOptions.isCustomElement` in the Vue plugin's options. See [Getting started](getting-started.md#vue).

## An animation does nothing, or moves only some parts

An animation moves bones by name. One made for another body - a mob, a custom model - moves bones this model lacks, and those parts do nothing. `viewer.info.missingBones` lists them. Custom models name their bones themselves: check the names in the model file.

## A file's animation will not load

Bedrock animation files are what Blockbench exports with File > Export > Export Animations. A syntax error in a Molang expression is reported with the animation, bone and channel it is in; the message is on `viewer.error`. Quaternion rotations are not supported: export Euler rotations.

## The picture is blurry

The viewer draws as many pixels as the screen shows, up to `pixelRatio` (the screen's, at most 2) and `maxResolution` (1024). Raise either for a large viewer on a high-density screen; each doubling of size is four times the work per frame.

## Many viewers are slow

Each viewer draws only when its picture changes and only while on screen, and viewers showing one skin load it once. Drawing is shared by one worker: for dozens animating at once, show stills (bedrock-skin's `renderPNG`) and a live viewer only for the one in focus.

## Armor and items look wrong

The textures must be laid out as the game's are: armor layer 1 (`*_1.png`, 64 by 32) for helmet, chestplate and boots, layer 2 (`*_2.png`) for leggings, and items as their 16 by 16 sprites. A chestplate drawn from layer 2 looks like leggings.
