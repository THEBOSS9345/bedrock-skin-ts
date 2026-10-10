<script setup>
import { ref } from 'vue'

const animation = ref('walk')
const spin = ref(true)
const frames = ref(0)
</script>

<template>
  <main style="font-family: system-ui; display: flex; gap: 24px; padding: 24px">
    <bedrock-skin-viewer
      id="vue-viewer"
      src="/skin.png"
      geometry="/geometry.json"
      :animation="animation"
      :auto-rotate="spin ? '' : null"
      style="width: 320px; height: 420px; background: #1b1f27; border-radius: 12px"
      @skinload="frames = $event.detail.frames"
    />
    <div>
      <h1>bedrock-skin-viewer + Vue</h1>
      <select id="vue-anim" v-model="animation">
        <option>walk</option>
        <option>wave</option>
        <option>dance</option>
        <option value="">none</option>
      </select>
      <label><input id="vue-spin" type="checkbox" v-model="spin" /> auto-rotate</label>
      <p id="vue-frames">{{ frames }} frames</p>
    </div>
  </main>
</template>
