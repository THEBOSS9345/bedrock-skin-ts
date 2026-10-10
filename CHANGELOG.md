# Changelog

## 0.1.3

- Fix: a cape came off the skin in any animation that moves the `root` bone - swimming, sitting, sneaking, spinning and many of the bundled examples. The cape's own chain of bones stops at the waist, so it never saw root move. It is now hung on the skin's skeleton and moves with it. Matches bedrock-skin-go v0.2.7.

## 0.1.2

- Fix: a cape worn with a chestplate was drawn inside it and hidden, since the chestplate reaches further back than the cape rests. With a chestplate worn, the cape now hangs 1.1 units further back, outside the armor, as Java Edition moves it. Matches bedrock-skin-go v0.2.6.

## 0.1.1

- The README's pictures and links work on npm.

## 0.1.0

The first release: a TypeScript port of bedrock-skin-go v0.2.5, drawing the same pixels.

- Rendering: bodies, heads and avatars, capes, custom geometry, persona skins, armor, elytra, held items and scale.
- Animation: the built-in motions, Bedrock animation files with Molang, 33 bundled examples, `prepareFrames` for drawing frames at a moving camera, and GIF output.
- Invisible-skin detection, geometry queries by path, and skins as the protocol sends them.
- ES modules and CommonJS, with types for both; no Node-only APIs, so it runs in browsers.
