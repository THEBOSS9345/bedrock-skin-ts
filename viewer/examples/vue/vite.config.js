import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// Tell Vue that <bedrock-skin-viewer> is a custom element, not a component.
export default defineConfig({
  plugins: [vue({ template: { compilerOptions: { isCustomElement: (tag) => tag === 'bedrock-skin-viewer' } } })],
})
