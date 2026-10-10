// Where the engine runs. By default every viewer on the page shares one Web
// Worker, so drawing never holds up the page. If the worker cannot start - a
// bundler that did not copy it, a Content-Security-Policy without
// worker-src - the engine is loaded onto the page instead, and the viewer
// works the same, only on the page's thread.

import type { Request, Response } from './protocol'

// WorkerOption says where a viewer draws:
//   - 'auto' (the default): the shared worker, or the page if it cannot start
//   - false: on the page's thread
//   - a Worker, or a function making one: a worker of your own, running
//     bedrock-skin-viewer/worker
export type WorkerOption = 'auto' | false | Worker | (() => Worker)

// A request without its id, which the backend adds; per kind of request.
type Ask = Request extends infer R ? (R extends unknown ? Omit<R, 'id'> : never) : never
type Answer = Exclude<Response, { ok: false }>

export interface Backend {
  ask(q: Ask): Promise<Answer>
}

// An error the engine answered with.
export class EngineError extends Error {
  override name = 'SkinViewerError'
}

// The page's own engine, loaded only when it is needed.
class PageBackend implements Backend {
  private engine: Promise<typeof import('./engine')> | undefined
  private next = 0

  async ask(q: Ask): Promise<Answer> {
    this.engine ??= import('./engine')
    const { res } = await (await this.engine).handle({ ...q, id: ++this.next } as Request)
    if (!res.ok) throw new EngineError(res.error)
    return res
  }
}

// How long a worker has to say it is ready before the page gives up on it.
const READY_TIMEOUT = 20_000

class WorkerBackend implements Backend {
  private next = 0
  private waiting = new Map<number, { q: Request; resolve: (r: Answer) => void; reject: (e: Error) => void }>()
  private queue: Request[] = []
  private ready = false
  private fallback: PageBackend | undefined

  constructor(private readonly worker: Worker) {
    worker.onmessage = (e: MessageEvent<Response | { ready: true }>) => {
      if ('ready' in e.data) {
        this.ready = true
        clearTimeout(timer)
        for (const q of this.queue) this.worker.postMessage(q)
        this.queue = []
        return
      }
      const r = e.data
      const w = this.waiting.get(r.id)
      this.waiting.delete(r.id)
      if (!w) return
      if (r.ok) w.resolve(r)
      else w.reject(new EngineError(r.error))
    }
    // A worker that fails to load says so with an error event.
    worker.onerror = (e) => {
      if (!this.ready) {
        e.preventDefault()
        this.giveUp()
      }
    }
    const timer = setTimeout(() => !this.ready && this.giveUp(), READY_TIMEOUT)
  }

  // giveUp moves to the page: everything asked so far is asked again there.
  private giveUp() {
    if (this.fallback) return
    this.worker.terminate()
    this.fallback = new PageBackend()
    for (const [, w] of this.waiting) this.fallback.ask(w.q).then(w.resolve, w.reject)
    this.waiting.clear()
    this.queue = []
  }

  ask(q: Ask): Promise<Answer> {
    if (this.fallback) return this.fallback.ask(q)
    const req = { ...q, id: ++this.next } as Request
    return new Promise((resolve, reject) => {
      this.waiting.set(req.id, { q: req, resolve, reject })
      if (this.ready) this.worker.postMessage(req)
      else this.queue.push(req)
    })
  }
}

let sharedWorker: Backend | undefined
let page: Backend | undefined

// defaultWorker starts the package's own worker. It is written exactly this
// way so bundlers (Vite, webpack, Parcel) see the worker and bundle it.
function defaultWorker(): Worker {
  return new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
}

export function backendFor(option: WorkerOption | undefined): Backend {
  if (option === false || typeof Worker === 'undefined') return (page ??= new PageBackend())
  if (option === undefined || option === 'auto') {
    if (!sharedWorker) {
      try {
        sharedWorker = new WorkerBackend(defaultWorker())
      } catch {
        sharedWorker = page ??= new PageBackend()
      }
    }
    return sharedWorker
  }
  return new WorkerBackend(typeof option === 'function' ? option() : option)
}
