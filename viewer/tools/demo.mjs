// Puts the live demo together in demo-site/: the page, the single-file
// build, and bedrock-skin's test skin. Run after npm run build; GitHub Pages
// serves the result.
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'

rmSync('demo-site', { recursive: true, force: true })
mkdirSync('demo-site')
copyFileSync('demo/index.html', 'demo-site/index.html')
copyFileSync('demo/cape.png', 'demo-site/cape.png')
copyFileSync('dist/bedrock-skin-viewer.min.js', 'demo-site/bedrock-skin-viewer.min.js')
copyFileSync('../testdata/bench-skin/texture.png', 'demo-site/skin.png')
copyFileSync('../testdata/bench-skin/geometry.json', 'demo-site/geometry.json')
console.log('demo-site/ is ready')
