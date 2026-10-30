<script setup lang="ts">
import { ArrowUpRight, Clock3, LoaderCircle } from 'lucide-vue-next'
import { useWorkspace } from '../workspace.ts'
import { assetUrl } from '../api.ts'
const workspace = useWorkspace()
const labels = { queued: '正在排队', running: '正在生成', succeeded: '生成完成', failed: '生成失败', interrupted: '状态待确认' }
</script>

<template>
  <header class="page-heading"><div><div class="eyebrow">THE CREATIVE ARCHIVE</div><h1>创作记录</h1><p>从原始商品资料，到最终生成结果，每一次创作都有记录。</p></div><span class="record-count">{{ workspace.generations.length.toString().padStart(2, '0') }}<small>次创作</small></span></header>
  <div v-if="!workspace.generations.length" class="empty-state bordered"><Clock3 :size="38" :stroke-width="1" /><h2>第一张作品，值得期待</h2><p>完成图片生成后，可以在这里查看结果与当时使用的商品资料。</p><button class="button button-dark" @click="workspace.view = 'studio'">前往创作工作台<ArrowUpRight :size="15" /></button></div>
  <div v-else class="history-list"><article v-for="task in workspace.generations" :key="task.id" class="history-item"><div class="history-thumbnail"><img v-if="task.resultAssetIds[0]" :src="assetUrl(task.resultAssetIds[0])" :alt="task.product.name" /><LoaderCircle v-else-if="task.status === 'queued' || task.status === 'running'" :size="24" class="spin" /><Clock3 v-else :size="24" /></div><div class="history-details"><div><h3>{{ task.product.name }}</h3><span class="status-badge" :class="task.status">{{ labels[task.status] }}</span></div><p>{{ task.input.scene }} · {{ task.input.style }}</p><small>{{ new Date(task.createdAt).toLocaleString('zh-CN') }} · 商品编码 {{ task.product.sku }} · 资料版本 {{ task.product.version }}</small><p v-if="task.error" class="error-text">{{ task.error }}</p></div><button class="icon-button" aria-label="查看本次创作" @click="workspace.activeGenerationId = task.id; workspace.view = 'studio'"><ArrowUpRight :size="20" /></button></article></div>
</template>
