<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowDownToLine, ArrowUpRight, Images, Plus } from 'lucide-vue-next'
import { useWorkspace } from '../workspace.ts'
import { assetUrl } from '../api.ts'
import UploadCard from './UploadCard.vue'
import ModalShell from './ModalShell.vue'
const workspace = useWorkspace(), filter = ref('all'), open = ref(false), uploadedId = ref<string | null>(null), kind = ref<'model' | 'product'>('model')
const images = computed(() => workspace.assets.filter(item => filter.value === 'all' || item.kind === filter.value))
const labels: Record<string, string> = { model: '模特图片', product: '商品图片', result: '生成作品' }
</script>

<template>
  <header class="page-heading"><div><div class="eyebrow">A LIBRARY OF POSSIBILITIES</div><h1>创作素材</h1><p>保留每一张原图，也保留每一次创作。</p></div><button class="button button-dark" @click="open = true"><Plus :size="16" />上传素材</button></header>
  <div class="filter-tabs"><button v-for="tab in [{ id: 'all', name: '全部素材' }, { id: 'model', name: '模特图片' }, { id: 'product', name: '商品图片' }, { id: 'result', name: '生成作品' }]" :key="tab.id" :class="{ active: filter === tab.id }" @click="filter = tab.id">{{ tab.name }}</button></div>
  <div v-if="!images.length" class="empty-state bordered"><Images :size="38" :stroke-width="1" /><h2>为下一次创作，准备素材</h2><p>上传模特图与商品图，或在工作台完成一次真实生成。</p><button class="button button-dark" @click="open = true"><Plus :size="15" />上传素材</button></div>
  <div v-else class="asset-grid"><article v-for="item in images" :key="item.id" class="asset-tile"><div class="asset-tile-image"><img :src="assetUrl(item.id)" :alt="item.name" loading="lazy" /><span>{{ labels[item.kind] }}</span><a :href="`${assetUrl(item.id)}?download=1`" download class="asset-download" :aria-label="`下载${item.name}`"><ArrowDownToLine :size="17" /></a></div><div class="asset-tile-info"><strong>{{ item.name }}</strong><span>{{ item.width }} × {{ item.height }}<button v-if="item.kind !== 'result'" class="icon-button" aria-label="将素材用于创作" @click="() => { if (item.kind === 'model') workspace.draft.modelAssetId = item.id; else workspace.draft.productAssetId = item.id; workspace.view = 'studio' }"><ArrowUpRight :size="16" /></button></span></div></article></div>
  <ModalShell :open="open" title="上传创作素材" @close="open = false"><div class="filter-tabs"><button :class="{ active: kind === 'model' }" @click="kind = 'model'; uploadedId = null">模特图片</button><button :class="{ active: kind === 'product' }" @click="kind = 'product'; uploadedId = null">商品图片</button></div><UploadCard :key="kind" v-model:asset-id="uploadedId" :kind="kind" :title="kind === 'model' ? '模特图片' : '商品图片'" caption="选择准备上传的图片" /><div class="modal-footer"><button class="button button-dark" @click="open = false">完成</button></div></ModalShell>
</template>
