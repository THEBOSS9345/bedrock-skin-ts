# Notes for coding agents

Contributions written with AI assistance are welcome. Read this first.

## What this project is

A TypeScript library, for browsers and servers, that renders Minecraft Bedrock skins to images and detects invisible skins. It is a port of [bedrock-skin-go](https://github.com/THEBOSS9345/bedrock-skin-go), and **the two must produce identical output**: same pixels, same pose values to the bit, same reports. The tests in `test/` enforce it against reference output the Go library wrote, in `testdata/`.

The Go library is the reference. When this port and Go disagree, this port is wrong, even where Go's behaviour looks odd.

## Read before changing code

bedrock-skin-go's [`docs/`](https://github.com/THEBOSS9345/bedrock-skin-go/tree/main/docs) applies here, file for file:

| Doc | When it matters |
| --- | --- |
| design-decisions.md | **Before changing anything that looks wrong** |
| rendering-pipeline.md | `mesh.ts`, `render.ts`, `raster.ts` |
| geometry-format.md | `geometry.ts`, `geoquery.ts` |
| skin-data.md | How skins arrive over the wire, `wire.ts` |
| animation.md | `pose.ts`, `frames.ts`, `animfile.ts`, `molang.ts` |

## Rules that are easy to break

- **Do not swap in JavaScript's own maths.** `Math.sin`, `cos`, `tan`, `atan2`, `exp`, `log` and `pow` are only required to be close, and differ between engines in the last bit, which is enough to move a pixel. Use `gomath.ts`, which ports Go's. `Math.sqrt`, `floor`, `ceil`, `trunc` and `abs` are exact everywhere and fine; `Math.round` is not Go's (it rounds -2.5 to -2) - use `gomath.round`. `Math.min`/`max` are kept to Go's versions too.
- **Do not "simplify" arithmetic.** `raster.ts`, `mesh.ts` and `render.ts` do floating-point operations in the same order as the Go code. Reordering, or folding `a * b + c` differently, changes the last bit and breaks parity.
- **JSON is read by `json.ts` and `jsonread.ts`, not `JSON.parse`**, to match Go's decoder exactly: `JSON.parse` moves integer-like keys first (animation keyframes are keyed by time) and keeps only the last of a repeated key. Keys match case-insensitively, null leaves a field alone, and a type error does not stop the rest being read.
- **Strings compare by bytes**, as Go's do: `compareBytes`, not `<` or `localeCompare`. Lower-case with `toLower` and trim with `trimSpace` (`strings.ts`), not `toLowerCase` and `trim`, which differ from Go on a few characters.
- **The rasterizer is not fauxgl's in three places**, on purpose and in every version: edges are evaluated per pixel, only the near and far planes clip, and a depth tie within `DEPTH_TIE` goes to the face drawn first. Do not "restore" fauxgl's edge stepping, side clipping or `<=` depth test; each drew visible lines or speckles.
- **No Node-only APIs in `src/`.** It runs in browsers: no `Buffer`, `fs` or `process`. `test/` and `tools/` may use Node.
- **A behaviour change goes into the Go library first.** Change it there, regenerate the fixtures (`cd tools/parity && go run .`), then change this port until `npm test` passes. Never edit `testdata/parity` or `testdata/golden` by hand.
- **Watch for invisible characters.** Some editors and tools turn an escape such as `\u2028` in a regular expression into the character itself, which breaks the source. Keep such characters as escapes.
- `src/generated/` is made from `src/data/` by `node tools/embed.mjs`; edit the data, not the generated files.
- Comments stay brief and point into the docs.

## Before a PR

`npm run check`: it typechecks, runs the tests, builds, and checks the package works from both `import` and `require`.

## Layout

```
src/index.ts        the public API
src/render.ts       RenderOptions, views, framing, the camera
src/mesh.ts         bones and cubes to triangles
src/polymesh.ts     poly meshes: persona skins
src/raster.ts       the rasterizer: fauxgl's, ported and specialised
src/render2d.ts     the flat fallback, for geometry that draws nothing
src/equipment.ts    armor, elytra, held items, scale
src/geometry.ts     geometry.json, both formats
src/geoquery.ts     GeometryTree: values by path
src/json.ts         a JSON parser that keeps what Go's decoder sees
src/jsonread.ts     reading JSON with Go's rules
src/pose.ts         Pose, BonePose, the built-in motions
src/frames.ts       prepareFrames, Frames, renderFrames
src/animfile.ts     Bedrock animation files
src/molang.ts       Molang expressions
src/gomath.ts       Go's maths, ported
src/invisible.ts    the visibility checks
src/detect.ts       Skin and SkinReport
src/wire.ts         skins as the protocol sends them
src/png.ts          PNG decoding and encoding
src/gif.ts          GIF encoding
src/bytes.ts        encoded files in, encoded files out
tools/parity        the Go program that writes testdata/parity
tools/embed.mjs     src/data into src/generated
tools/images.mjs    the pictures in README.md
```
