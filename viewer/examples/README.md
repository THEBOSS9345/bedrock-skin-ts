# Examples

Each folder is a small app using bedrock-skin-viewer as a site would, from npm:

- `react` - the React component, with every control: animations, models,
  armor and a held item, views, speed, uploads, snapshots, and several viewers
  on one page
- `vue` - the custom element in a Vue app
- `html` - the custom element on a plain page, no framework

```bash
cd react
npm install
npm run dev
```

The skin is bedrock-skin's test skin. The armor and sword are drawn by the
example itself: Minecraft's own textures belong to Mojang, so a real site
points the viewer at its resource pack's files.
