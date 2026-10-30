<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowDownToLine, ArrowRight, Check, FileText, LoaderCircle, ScanLine, Sparkles } from 'lucide-vue-next'
import { generationSchema } from '../../../shared/contracts.ts'
import { useWorkspace } from '../workspace.ts'
import { assetUrl, requestApi } from '../api.ts'
import UploadCard from './UploadCard.vue'
import AgentPanel from './AgentPanel.vue'
import ModalShell from './ModalShell.vue'
const workspace = useWorkspace(), busy = ref(false), showPrompt = ref(false)
const product = computed(() => workspace.products.find(item => item.id === workspace.draft.productId))
const task = computed(() => workspace.generations.find(item => item.id === workspace.activeGenerationId) ?? workspace.generations[0])
const canGenerate = computed(() => workspace.integration.imageReady && product.value && product.value.stock > 0 && workspace.draft.modelAssetId && workspace.draft.productAssetId && workspace.draft.scene.trim() && workspace.draft.style.trim() && !busy.value)
const statusLabels = { queued: '正在排队', running: '正在生成', succeeded: '生成完成', failed: '生成失败', interrupted: '状态待确认' }
let requestKey = crypto.randomUUID()

function chooseProduct(event: Event) {
  if (!(event.target instanceof HTMLSelectElement)) throw new Error('商品选择器不可用')
  workspace.selectProduct(event.target.value)
}

async function generate() {
  if (!product.value || !canGenerate.value) return
  busy.value = true
  const result = await requestApi('/generations', generationSchema, { method: 'POST', body: JSON.stringify({
    requestKey, productId: product.value.id, productVersion: product.value.version, modelAssetId: workspace.draft.modelAssetId,
    productAssetId: workspace.draft.productAssetId, scene: workspace.draft.scene, style: workspace.draft.style, instructions: workspace.draft.instructions,
    ratio: '3:4', ...(workspace.adoptedPlanId ? { planId: workspace.adoptedPlanId } : {}),
  }) }).finally(() => { busy.value = false })
  workspace.activeGenerationId = result.id
  const existing = workspace.generations.find(item => item.id === result.id)
  if (!existing || existing.updatedAt <= result.updatedAt) workspace.generations = [result, ...workspace.generations.filter(item => item.id !== result.id)]
  requestKey = crypto.randomUUID()
}
</script>

<template>
  <section class="studio-hero"><div><div class="eyebrow">MADE FOR RETAIL STORES</div><h1>让门店好货，更好地被看见<span>。</span></h1><p>围绕在售商品与实际库存，为门店上新、导购推荐和社群营销准备搭配图片。</p></div><span class="edition-label">DIANDA<br />STORE / 01</span></section>
  <div class="studio-layout">
    <section class="creation-panel">
      <div class="section-label"><span><i class="step-index">01</i>选择创作素材</span><span class="micro-label">SOURCE MATERIALS</span></div>
      <div class="upload-grid"><UploadCard v-model:asset-id="workspace.draft.modelAssetId" kind="model" title="模特图片" caption="选择画面中的人物" /><UploadCard v-model:asset-id="workspace.draft.productAssetId" kind="product" title="商品图片" caption="选择需要展示的商品" /></div>
      <label class="field-label" for="studio-product">关联本店商品</label>
      <select id="studio-product" :value="workspace.draft.productId" @change="chooseProduct"><option value="">选择商品，读取真实商品资料</option><option v-for="item in workspace.products" :key="item.id" :value="item.id" :disabled="item.stock < 1">{{ item.name }} · {{ item.sku }}{{ item.stock < 1 ? ' · 暂无库存' : '' }}</option></select>
      <div v-if="product" class="product-context"><Check :size="14" /><span>{{ product.category }}<template v-if="product.color"> · {{ product.color }}</template><template v-if="product.material"> · {{ product.material }}</template></span><small>库存 {{ product.stock }}</small></div>
      <div v-else-if="!workspace.products.length" class="inline-notice">还没有商品资料。<button class="text-button" @click="workspace.view = 'catalog'">导入 CSV 商品文件<ArrowRight :size="12" /></button></div>
      <div class="section-label second-step"><span><i class="step-index">02</i>定义画面风格</span><span class="micro-label">CREATIVE DIRECTION</span></div>
      <div class="field-pair"><label class="field-label">拍摄场景<input v-model="workspace.draft.scene" maxlength="500" placeholder="例如：自然光下的城市街景" /></label><label class="field-label">视觉风格<input v-model="workspace.draft.style" maxlength="200" placeholder="例如：自然、清爽的电商摄影" /></label></div>
      <label class="field-label">补充创作要求<textarea v-model="workspace.draft.instructions" maxlength="2000" rows="2" placeholder="例如：保留衣服的刺绣细节，背景干净，突出面料质感" /></label>
      <div class="generation-toolbar"><span><ScanLine :size="15" /> 竖版 3:4</span><span v-if="workspace.adoptedPlanId" class="plan-applied"><Check :size="13" />已采用 Agent 方案</span><button class="button button-dark" :disabled="!canGenerate" @click="generate"><LoaderCircle v-if="busy" class="spin" :size="17" /><Sparkles v-else :size="17" />生成搭配图<ArrowRight :size="16" /></button></div>
      <div v-if="!workspace.integration.imageReady" class="inline-notice">{{ workspace.integration.workflowPublished ? '生图服务尚未连接。' : '生图工作流保留为草稿，API 调用暂未启用。' }}<button class="text-button" @click="workspace.view = 'settings'">查看接入设置</button></div>
    </section>
    <section class="preview-panel">
      <div class="preview-heading"><span>创作预览</span><span class="micro-label">YOUR NEXT VISUAL</span></div>
      <div class="preview-canvas" :class="{ 'has-image': task?.status === 'succeeded' }">
        <img v-if="task?.status === 'succeeded' && task.resultAssetIds[0]" :src="assetUrl(task.resultAssetIds[0])" :alt="`${task.product.name}的搭配图`" />
        <div v-else-if="task" class="canvas-state"><LoaderCircle v-if="task.status === 'queued' || task.status === 'running'" class="spin" :size="32" :stroke-width="1" /><ScanLine v-else :size="32" :stroke-width="1" /><span class="eyebrow">{{ statusLabels[task.status] }}</span><p>{{ task.error || '生成完成后，图片会保存在创作记录中。' }}</p></div>
        <div v-else class="canvas-state"><div class="canvas-mark">D</div><span class="eyebrow">IMAGINE THE POSSIBILITIES</span><p>两张图片，一种新的表达。<br />你的第一张搭配图，从这里开始。</p></div>
        <span class="canvas-corner top-left"></span><span class="canvas-corner bottom-right"></span>
      </div>
      <div class="preview-footer"><div><span>{{ task ? task.product.name : '留白，等待灵感' }}</span><small>{{ task ? new Date(task.createdAt).toLocaleString('zh-CN') : '真实生成结果将在这里展示' }}</small></div><div v-if="task" class="preview-actions"><button class="icon-button" aria-label="查看生成资料与提示词" @click="showPrompt = true"><FileText :size="17" /></button><a v-if="task.resultAssetIds[0]" class="icon-button" aria-label="下载生成图片" :href="`${assetUrl(task.resultAssetIds[0])}?download=1`" download><ArrowDownToLine :size="17" /></a></div></div>
    </section>
  </div>
  <AgentPanel />
  <ModalShell :open="showPrompt" title="本次生成使用的商品资料与提示词" wide @close="showPrompt = false"><template v-if="task"><p class="muted">商品编码 {{ task.product.sku }} · 资料版本 {{ task.product.version }}</p><pre class="prompt-content">{{ task.prompt }}</pre></template></ModalShell>
</template>
