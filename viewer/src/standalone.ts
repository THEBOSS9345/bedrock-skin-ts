// The single-file build, for a page with no bundler:
//
//   <script src="https://cdn.jsdelivr.net/npm/bedrock-skin-viewer"></script>
//   <bedrock-skin-viewer src="skin.png" animation="walk"></bedrock-skin-viewer>
//
// It carries everything - bedrock-skin, the viewer and its worker's code -
// defines <bedrock-skin-viewer>, and as a classic script puts the API on
// window.BedrockSkinViewer.

import workerSource from 'virtual:worker-source'
import { useDefaultWorker } from './backend'
import { defineSkinViewerElement, SkinViewerElement } from './element'

// The worker runs from its code, as a Blob. A page whose Content-Security-
// Policy forbids blob: workers draws on the page instead, by itself.
let url: string | undefined
useDefaultWorker(() => {
  url ??= URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
  return new Worker(url)
})

export * from './index'
export { defineSkinViewerElement, SkinViewerElement }
