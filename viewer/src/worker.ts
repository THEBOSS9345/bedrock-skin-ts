// The viewer's Web Worker: the engine, off the page's thread. It says it is
// ready as soon as it starts, so the page knows the worker loaded.
//
// A page that makes its own worker (the `worker` option) points it here:
//   new Worker(new URL('bedrock-skin-viewer/worker', import.meta.url), { type: 'module' })

import { handle } from './engine'
import type { Request } from './protocol'

const scope = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void
  onmessage: ((e: MessageEvent<Request>) => void) | null
}

scope.onmessage = async (e) => {
  const { res, transfer } = await handle(e.data)
  scope.postMessage(res, transfer ?? [])
}
scope.postMessage({ ready: true })
