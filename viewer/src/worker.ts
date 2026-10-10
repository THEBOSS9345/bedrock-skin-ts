// The viewer's Web Worker: the engine, off the page's thread. It says it is
// ready as soon as it starts, so the page knows the worker loaded.
//
// A bundler that handles `new Worker(new URL(...))` bundles this file with
// the viewer; the single-file build carries it inside as text.

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
