<script setup lang="ts">
import { Check, CircleHelp, ExternalLink, RefreshCw, Unplug } from 'lucide-vue-next'
import { useWorkspace } from '../workspace.ts'
const workspace = useWorkspace()
</script>

<template>
  <header class="page-heading"><div><div class="eyebrow">CONNECTED TO CREATE</div><h1>服务连接</h1><p>连接 Coze 生图工作流和搭配策划 Agent。</p></div><button class="button button-plain" @click="workspace.load()"><RefreshCw :size="15" />刷新连接状态</button></header>
  <div class="settings-grid">
    <section class="settings-card">
      <div class="settings-icon"><Check v-if="workspace.integration.imageReady" :size="22" /><Unplug v-else :size="22" /></div>
      <h2>商品搭配图生成</h2>
      <span class="status-badge" :class="workspace.integration.imageReady ? 'succeeded' : 'interrupted'">{{ !workspace.integration.workflowPublished ? '草稿阶段' : workspace.integration.imageReady ? '已配置' : '尚未连接' }}</span>
      <p>输入模特图、商品图和包含商品资料的创作要求，生成一张竖版搭配图。</p>
      <dl><div><dt>工作流</dt><dd>{{ workspace.integration.workflowId || '等待填写工作流 ID' }}</dd></div></dl>
    </section>
    <section class="settings-card">
      <div class="settings-icon"><Check v-if="workspace.integration.agentReady" :size="22" /><Unplug v-else :size="22" /></div>
      <h2>搭配策划 Agent</h2>
      <span class="status-badge" :class="workspace.integration.agentReady ? 'succeeded' : 'interrupted'">{{ !workspace.integration.agentPublished ? '草稿阶段' : workspace.integration.agentReady ? '已配置' : '尚未连接' }}</span>
      <p>查询本店商品、读取真实资料并准备搭配方案，商家采纳后再生成图片。</p>
      <dl><div><dt>智能体</dt><dd>{{ workspace.integration.botId || '等待填写智能体 ID' }}</dd></div></dl>
    </section>
    <section class="settings-card">
      <div class="settings-icon"><Check v-if="workspace.searchStatus?.state === 'ready' && !workspace.searchStatus.failed" :size="22" /><Unplug v-else :size="22" /></div>
      <h2>商品语义检索</h2>
      <span class="status-badge" :class="workspace.searchStatus?.state === 'ready' ? 'succeeded' : 'interrupted'">{{ workspace.searchStatus?.state === 'ready' ? '已连接 Qdrant' : workspace.searchStatus?.state === 'preparing' ? '正在准备' : '尚未连接' }}</span>
      <p>根据自然语言要求查找本店商品。中文向量模型在本机运行，商品新增、修改和导入后自动同步索引。</p>
      <dl><div><dt>商品索引</dt><dd>{{ workspace.searchStatus?.indexed ?? 0 }}/{{ workspace.searchStatus?.total ?? 0 }}</dd></div><div><dt>模型</dt><dd>{{ workspace.searchStatus?.model || '等待服务连接' }}</dd></div><div><dt>向量维度</dt><dd>{{ workspace.searchStatus?.dimensions ?? '—' }}</dd></div></dl>
      <p v-if="workspace.searchStatus?.error" class="inline-notice">{{ workspace.searchStatus.error }}</p>
    </section>
  </div>
  <section class="setup-guide"><div class="section-label"><span><CircleHelp :size="18" />项目接入配置</span></div><p>当前工作流与 Agent 保持草稿。完成资源发布后，可在项目 <code>.env</code> 中填写访问令牌并开启对应调用配置，再重新启动服务。</p><pre>COZE_API_TOKEN=你的访问令牌
COZE_WORKFLOW_ID=生图工作流ID
COZE_BOT_ID=搭配策划Agent的ID
COZE_WORKFLOW_PUBLISHED=false
COZE_AGENT_PUBLISHED=false</pre><p>两个 PUBLISHED 字段记录对应资源的发布状态。访问令牌仅保存在服务端，配置说明位于项目 <code>docs</code> 目录。</p><a class="text-button" href="https://docs.coze.cn/guides_image_generation_node" target="_blank" rel="noreferrer">Coze 图像生成节点文档<ExternalLink :size="13" /></a></section>
</template>
