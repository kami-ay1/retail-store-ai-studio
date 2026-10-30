<script setup lang="ts">
import { computed, ref } from 'vue'
import { Bot, ArrowUp, Check, CheckCheck, ChevronDown, LoaderCircle, Search, Wrench } from 'lucide-vue-next'
import { agentRunSchema } from '../../../shared/contracts.ts'
import { useWorkspace } from '../workspace.ts'
import { requestApi } from '../api.ts'
const workspace = useWorkspace(), request = ref(''), busy = ref(false), expanded = ref<number | null>(null)
const run = computed(() => workspace.agentRuns[0])
const labels: Record<string, string> = { search_products: '查询本店商品', get_product: '读取商品资料', propose_outfit: '准备搭配方案' }
async function submit() {
  busy.value = true
  const result = await requestApi('/agent/runs', agentRunSchema, { method: 'POST', body: JSON.stringify({ request: request.value }) }).finally(() => { busy.value = false })
  workspace.agentRuns = [result, ...workspace.agentRuns.filter(item => item.id !== result.id)]
  request.value = ''
}
</script>

<template>
  <section class="agent-panel">
    <div class="section-label"><span><Bot :size="18" /> 搭配策划 Agent</span><span class="micro-label">YOUR CREATIVE PARTNER</span></div>
    <p class="muted">描述场景与风格，让 Agent 从本店商品中准备搭配方案。</p>
    <form class="agent-composer" @submit.prevent="submit">
      <textarea v-model="request" aria-label="搭配策划要求" placeholder="例如：从店里的连衣裙中选一款，为周末出游设计一张自然光搭配图……" maxlength="2000" required rows="3" />
      <div class="composer-bottom"><span><Search :size="13" /> 只查询本店商品</span><button class="send-button" :disabled="busy || run?.status === 'running' || !workspace.integration.agentReady || request.trim().length < 2" aria-label="提交搭配策划"><LoaderCircle v-if="busy || run?.status === 'running'" class="spin" :size="17" /><ArrowUp v-else :size="18" /></button></div>
    </form>
    <div v-if="!workspace.integration.agentReady" class="inline-notice">{{ workspace.integration.agentPublished ? '搭配 Agent 尚未连接。' : '搭配 Agent 保留为草稿，API 调用暂未启用。' }}<button class="text-button" @click="workspace.view = 'settings'">查看接入设置</button></div>
    <div v-if="run" class="agent-run">
      <div class="run-question">{{ run.request }}</div>
      <div v-for="event in run.events" :key="event.id" class="agent-event" :class="event.kind">
        <template v-if="event.kind === 'tool_call' || event.kind === 'tool_result'">
          <button class="tool-event-button" @click="expanded = expanded === event.id ? null : event.id"><Wrench v-if="event.kind === 'tool_call'" :size="13" /><CheckCheck v-else :size="13" /><span>{{ event.tool ? labels[event.tool] || event.tool : event.text }}</span><small>{{ event.kind === 'tool_call' ? '调用' : '完成' }}</small><ChevronDown :size="13" /></button>
          <pre v-if="expanded === event.id">{{ JSON.stringify(event.data, null, 2) }}</pre>
        </template>
        <p v-else>{{ event.text }}</p>
      </div>
      <article v-for="plan in run.plans" :key="plan.id" class="plan-card"><div class="micro-label">OUTFIT PLAN</div><h3>{{ plan.title }}</h3><p>{{ plan.rationale }}</p><dl><div><dt>场景</dt><dd>{{ plan.scene }}</dd></div><div><dt>风格</dt><dd>{{ plan.style }}</dd></div></dl><button class="button button-dark button-full" @click="workspace.adoptPlan(plan)"><Check :size="15" />{{ workspace.adoptedPlanId === plan.id ? '已采纳方案' : '采纳方案并准备生图' }}</button></article>
      <p v-if="run.status === 'running'" class="status-line"><LoaderCircle :size="14" class="spin" />正在根据实际商品资料策划</p>
      <p v-if="run.status === 'interrupted'" class="inline-notice">本次策划已中断，可以重新提交要求。</p>
    </div>
  </section>
</template>
