// Marks the React entry as client code, so Next.js and other React Server
// Components frameworks can import it straight into a server component.
import { readFileSync, writeFileSync } from 'node:fs'

const file = 'dist/react.js'
const js = readFileSync(file, 'utf8')
if (!js.startsWith('"use client"')) writeFileSync(file, `"use client";\n${js}`)
