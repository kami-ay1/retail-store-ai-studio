<script setup lang="ts">
import { computed, onMounted, reactive, ref, type Component } from 'vue'
import { ArrowRight, Check, CircleHelp, Clock3, Images, LayoutGrid, LogOut, Package, Settings2, Sparkles, X } from 'lucide-vue-next'
import { sessionSchema } from '../../shared/contracts.ts'
import { requestApi } from './api.ts'
import { notice } from './notifications.ts'
import { useWorkspace } from './workspace.ts'
import StudioView from './components/StudioView.vue'
import CatalogView from './components/CatalogView.vue'
import LibraryView from './components/LibraryView.vue'
import HistoryView from './components/HistoryView.vue'
import SettingsView from './components/SettingsView.vue'
const workspace = useWorkspace(), loaded = ref(false), register = ref(false), submitting = ref(false)
const auth = reactive({ merchantName: '', email: '', password: '' })
const nav: { id: ReturnType<typeof useWorkspace>['view']; label: string; icon: Component }[] = [{ id: 'studio', label: '创作工作台', icon: LayoutGrid }, { id: 'catalog', label: '本店商品', icon: Package }, { id: 'library', label: '创作素材', icon: Images }, { id: 'history', label: '创作记录', icon: Clock3 }, { id: 'settings', label: '服务连接', icon: Settings2 }]
const counts = computed(() => ({ studio: null, catalog: workspace.products.length, library: workspace.assets.length, history: workspace.generations.length, settings: null }))
async function authenticate() {
  submitting.value = true
  const session = await requestApi(register.value ? '/auth/register' : '/auth/login', sessionSchema, { method: 'POST', body: JSON.stringify(auth) }).finally(() => { submitting.value = false })
  auth.password = ''
  await workspace.authenticate(session)
}
onMounted(async () => { await workspace.restore().finally(() => { loaded.value = true }) })
</script>

<template>
  <div v-if="!loaded" class="boot-screen"><span class="wordmark">MÓYOU<span>魔柚</span></span><p>正在打开创作工作台</p></div>
  <main v-else-if="!workspace.session" class="auth-page"><section class="auth-art"><span class="wordmark light">MÓYOU<span>魔柚</span></span><div class="auth-editorial"><span class="eyebrow">MADE FOR YOUR NEXT CREATION</span><h1>商品有细节，<br />表达有灵感。</h1><p>把真实商品与新的想象连接起来。<br />从一张图片，开始下一次创作。</p><div class="auth-type">GOOD<br /><i>GOODS.</i></div></div><div class="auth-footnote">MERCHANT CREATIVE STUDIO <span>01 / MOYOU</span></div></section><section class="auth-form-section"><div class="auth-form-wrap"><span class="eyebrow">WELCOME TO YOUR STUDIO</span><h2>{{ register ? '创建商家工作室' : '欢迎回到魔柚' }}</h2><p class="muted">{{ register ? '为店铺建立独立的商品、素材与创作空间。' : '登录后继续你的商品搭配图创作。' }}</p><form class="auth-form" @submit.prevent="authenticate"><label v-if="register" class="field-label">商家名称<input v-model="auth.merchantName" required minlength="2" maxlength="60" autocomplete="organization" placeholder="你的店铺或工作室名称" /></label><label class="field-label">邮箱地址<input v-model="auth.email" required type="email" maxlength="160" autocomplete="username" placeholder="you@studio.com" /></label><label class="field-label">登录密码<input v-model="auth.password" required type="password" minlength="10" maxlength="128" :autocomplete="register ? 'new-password' : 'current-password'" placeholder="至少 10 个字符" /></label><button class="button button-dark button-full" :disabled="submitting">{{ submitting ? '正在进入工作室' : register ? '创建工作室' : '登录工作室' }}<ArrowRight :size="17" /></button></form><p class="auth-switch">{{ register ? '已有商家账户？' : '还没有商家账户？' }}<button class="text-button" @click="register = !register">{{ register ? '返回登录' : '创建工作室' }}</button></p><div class="auth-note"><Check :size="15" />商品与素材按商家独立保存</div></div></section></main>
  <div v-else class="app-shell"><aside class="sidebar"><div class="wordmark">MÓYOU<span>魔柚</span></div><div class="sidebar-section-label">商家创作空间</div><nav aria-label="工作台导航"><button v-for="item in nav" :key="item.id" :class="['nav-item', { active: workspace.view === item.id }]" @click="() => { if (item.id === 'studio' || item.id === 'catalog' || item.id === 'library' || item.id === 'history' || item.id === 'settings') workspace.view = item.id }"><component :is="item.icon" :size="18" :stroke-width="1.5" /><span>{{ item.label }}</span><small v-if="counts[item.id as keyof typeof counts] !== null">{{ counts[item.id as keyof typeof counts] }}</small></button></nav><div class="sidebar-note"><Sparkles :size="19" :stroke-width="1.2" /><p>商品资料 × 创作灵感</p><span>让每一次表达，都有所依据。</span></div><div class="sidebar-bottom"><span>MOYOU CREATIVE STUDIO</span><small>为真实商品，创造新的可能。</small></div></aside><div class="workspace-shell"><header class="topbar"><div class="breadcrumb">商家工作台<span>/</span>{{ nav.find(item => item.id === workspace.view)?.label }}</div><div class="topbar-right"><span class="connection-dot" :class="{ online: workspace.connected }"></span><span class="connection-text">{{ workspace.connected ? '状态已连接' : '正在连接' }}</span><span class="merchant-avatar">MO</span><span class="merchant-name">{{ workspace.session.merchantName }}</span><button class="icon-button" aria-label="退出商家账户" @click="workspace.logout()"><LogOut :size="17" /></button></div></header><main class="main-content"><StudioView v-if="workspace.view === 'studio'" /><CatalogView v-else-if="workspace.view === 'catalog'" /><LibraryView v-else-if="workspace.view === 'library'" /><HistoryView v-else-if="workspace.view === 'history'" /><SettingsView v-else /></main><footer class="workspace-footer"><span>每一件商品，都值得被认真呈现。</span><button class="text-button" @click="workspace.view = 'settings'"><CircleHelp :size="13" />服务连接与帮助</button></footer></div></div>
  <div v-if="notice" role="alert" class="notice-toast" :class="notice.type"><span>{{ notice.text }}</span><button class="icon-button" aria-label="关闭通知" @click="notice = null"><X :size="16" /></button></div>
</template>
