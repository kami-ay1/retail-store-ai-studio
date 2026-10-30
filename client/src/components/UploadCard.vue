<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { ArrowUpRight, ImagePlus, LoaderCircle, Replace } from 'lucide-vue-next'
import { assetSchema } from '../../../shared/contracts.ts'
import { requestApi, assetUrl } from '../api.ts'
import { useWorkspace } from '../workspace.ts'
const props = defineProps<{ kind: 'model' | 'product'; assetId: string | null; title: string; caption: string }>()
const emit = defineEmits<{ 'update:assetId': [id: string | null] }>()
const workspace = useWorkspace()
const inputId = useId(), busy = ref(false), dragging = ref(false)
const asset = computed(() => workspace.assets.find(item => item.id === props.assetId))
const available = computed(() => workspace.assets.filter(item => item.kind === props.kind))
const selected = computed({ get: () => props.assetId ?? '', set: value => emit('update:assetId', value || null) })

async function upload(file: File) {
  if (file.size > 5 * 1024 * 1024) throw new Error('参考图片不能超过 5 MB')
  busy.value = true
  const form = new FormData(); form.set('file', file); form.set('kind', props.kind)
  const uploaded = await requestApi('/assets', assetSchema, { method: 'POST', body: form }).finally(() => { busy.value = false })
  workspace.assets = [uploaded, ...workspace.assets]
  emit('update:assetId', uploaded.id)
}

async function changed(event: Event) {
  if (!(event.target instanceof HTMLInputElement)) throw new Error('图片选择器不可用')
  const file = event.target.files?.item(0)
  if (file) await upload(file)
  event.target.value = ''
}

async function dropped(event: DragEvent) {
  dragging.value = false
  const file = event.dataTransfer?.files.item(0)
  if (file) await upload(file)
}
</script>

<template>
  <div :class="['upload-card', { dragging, filled: asset }]" @dragover.prevent="dragging = true" @dragleave.prevent="dragging = false" @drop.prevent="dropped">
    <div class="upload-caption"><span>{{ title }}</span><ArrowUpRight :size="15" /></div>
    <label :for="inputId" class="upload-surface" :class="{ 'is-busy': busy }">
      <img v-if="asset" :src="assetUrl(asset.id)" :alt="asset.name" />
      <div v-else class="upload-empty"><ImagePlus :size="30" :stroke-width="1.2" /><strong>{{ caption }}</strong><span>点击上传或拖入图片</span><small>JPG / PNG / WebP · 5 MB 以内</small></div>
      <div v-if="busy" class="upload-loading"><LoaderCircle class="spin" :size="25" /><span>正在上传图片</span></div>
      <span v-if="asset" class="replace-tag"><Replace :size="13" /> 更换图片</span>
    </label>
    <input :id="inputId" class="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" :disabled="busy" :aria-label="title" @change="changed" />
    <div v-if="asset" class="asset-caption"><span>{{ asset.name }}</span><small>{{ asset.width }} × {{ asset.height }}</small></div>
    <select v-if="available.length" v-model="selected" class="library-select" :aria-label="`从素材库选择${title}`"><option value="">从素材库选择</option><option v-for="item in available" :key="item.id" :value="item.id">{{ item.name }}</option></select>
  </div>
</template>
