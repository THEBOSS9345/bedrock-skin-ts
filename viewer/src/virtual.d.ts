// The worker's code, as text: the single-file build makes it (tools/bundle.mjs).
declare module 'virtual:worker-source' {
  const source: string
  export default source
}
