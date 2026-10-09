// Embeds src/data/*.json into src/generated/*.ts as strings, for the parser
// in src/json.ts to read: importing them as JSON would reorder their keys.
// Run it after changing a file in src/data: node tools/embed.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'

for (const f of readdirSync('src/data')) {
  if (!f.endsWith('.json')) continue
  const name = f.replace(/\.json$/, '')
  const text = readFileSync(`src/data/${f}`, 'utf8')
  writeFileSync(
    `src/generated/${name}.ts`,
    `// Generated from src/data/${f} by tools/embed.mjs. Do not edit.\nexport default ${JSON.stringify(text)}\n`,
  )
}
