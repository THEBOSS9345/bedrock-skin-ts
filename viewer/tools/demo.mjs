// Puts the live demo together in demo-site/: the page, the single-file
// build, and bedrock-skin's test skin. Run after npm run build; GitHub Pages
// serves the result. The page says which versions and commit it was built
// from.
import { execSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const version = (path) => JSON.parse(readFileSync(path, 'utf8')).version
let commit = process.env.GITHUB_SHA ?? ''
if (!commit) {
  try {
    commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
  } catch {}
}
const built = [
  `bedrock-skin-viewer ${version('package.json')}`,
  `bedrock-skin ${version('node_modules/bedrock-skin/package.json')}`,
  commit && `built from <a href="https://github.com/THEBOSS9345/bedrock-skin-ts/commit/${commit}">${commit.slice(0, 7)}</a>`,
]
  .filter(Boolean)
  .join(' · ')

rmSync('demo-site', { recursive: true, force: true })
mkdirSync('demo-site')
const page = readFileSync('demo/index.html', 'utf8')
const marker = '<small id="versions"></small>'
if (!page.includes(marker)) throw new Error('demo/index.html has no ' + marker)
writeFileSync('demo-site/index.html', page.replace(marker, `<small id="versions">${built}</small>`))
copyFileSync('dist/bedrock-skin-viewer.min.js', 'demo-site/bedrock-skin-viewer.min.js')
copyFileSync('../testdata/bench-skin/texture.png', 'demo-site/skin.png')
copyFileSync('../testdata/bench-skin/geometry.json', 'demo-site/geometry.json')
console.log('demo-site/ is ready')
