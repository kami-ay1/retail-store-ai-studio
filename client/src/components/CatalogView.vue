<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ArrowDownToLine, ArrowUpFromLine, LoaderCircle, Package, Pencil, Plus, Search, Sparkles, X } from 'lucide-vue-next'
import { z } from 'zod'
import { productSchema, productSearchStatusSchema, semanticSearchResultSchema, type Product } from '../../../shared/contracts.ts'
import { requestApi, assetUrl } from '../api.ts'
import { useWorkspace } from '../workspace.ts'
import { notice, notifySuccess } from '../notifications.ts'
import ModalShell from './ModalShell.vue'
import UploadCard from './UploadCard.vue'
const workspace = useWorkspace(), search = ref(''), open = ref(false), busy = ref(false), importing = ref(false)
const editing = ref<Product | null>(null), csvInput = ref<HTMLInputElement | null>(null)
const searchMode = ref<'keyword' | 'semantic'>('keyword'), searching = ref(false), retrying = ref(false), inStock = ref(true)
const semanticResult = ref<z.output<typeof semanticSearchResultSchema> | null>(null)
const searchReady = computed(() => workspace.searchStatus?.state === 'ready' && workspace.searchStatus.pending === 0 && workspace.searchStatus.failed === 0)
let active = true, searchVersion = 0, statusTimer: ReturnType<typeof setInterval> | undefined
const form = reactive<{ sku: string; name: string; category: string; color: string; material: string; price: number; stock: number; description: string; imageAssetId: string | null }>({ sku: '', name: '', category: '', color: '', material: '', price: 0, stock: 0, description: '', imageAssetId: null })
const products = computed(() => searchMode.value === 'semantic' ? semanticResult.value?.results.map(item => item.product) ?? []
  : workspace.products.filter(item => `${item.name} ${item.sku} ${item.category}`.toLowerCase().includes(search.value.toLowerCase())))
watch([search, searchMode, inStock, () => workspace.products], () => { searchVersion += 1; searching.value = false; semanticResult.value = null })
onMounted(() => {
  statusTimer = setInterval(() => {
    void workspace.refreshSearchStatus().then(undefined, (error: unknown) => {
      if (active) notice.value = { text: error instanceof Error ? error.message : '商品检索状态读取失败', type: 'error' }
    })
  }, 2500)
})
onBeforeUnmount(() => { active = false; searchVersion += 1; if (statusTimer) clearInterval(statusTimer) })
async function searchSemantically() {
  const version = ++searchVersion, merchantId = workspace.session?.merchantId
  searching.value = true
  const result = await requestApi('/products/search', semanticSearchResultSchema, { method: 'POST', body: JSON.stringify({ query: search.value, inStock: inStock.value, limit: 12 }) })
    .finally(() => { if (active && version === searchVersion) searching.value = false })
  if (active && version === searchVersion && workspace.session?.merchantId === merchantId) semanticResult.value = result
}
async function retrySearch() {
  const merchantId = workspace.session?.merchantId
  retrying.value = true
  const result = await requestApi('/products/search-index/retry', productSearchStatusSchema, { method: 'POST' }).finally(() => { if (active) retrying.value = false })
  if (active && workspace.session?.merchantId === merchantId) workspace.searchStatus = result
}
function edit(product: Product | null) {
  editing.value = product
  Object.assign(form, product ? { ...product, price: product.priceCents / 100 } : { sku: '', name: '', category: '', color: '', material: '', price: 0, stock: 0, description: '', imageAssetId: null })
  open.value = true
}
async function save() {
  busy.value = true
  await requestApi(editing.value ? `/products/${editing.value.id}` : '/products', productSchema, { method: editing.value ? 'PATCH' : 'POST', body: JSON.stringify({
    sku: form.sku, name: form.name, category: form.category, color: form.color, material: form.material,
    priceCents: Math.round(form.price * 100), stock: form.stock, description: form.description, imageAssetId: form.imageAssetId,
    ...(editing.value ? { version: editing.value.version } : {}),
  }) }).finally(() => { busy.value = false })
  open.value = false
  await workspace.load()
  notifySuccess('商品资料已保存')
}
async function importCsv(event: Event) {
  if (!(event.target instanceof HTMLInputElement)) throw new Error('文件选择器不可用')
  const file = event.target.files?.item(0)
  if (!file) return
  importing.value = true
  const body = new FormData(); body.set('file', file)
  const result = await requestApi('/products/import', z.object({ imported: z.number() }), { method: 'POST', body }).finally(() => { importing.value = false; if (csvInput.value) csvInput.value.value = '' })
  await workspace.load()
  notifySuccess(`已导入 ${result.imported} 条商品资料`)
}
</script>

<template>
  <header class="page-heading"><div><div class="eyebrow">PRODUCTS WITH CONTEXT</div><h1>本店商品</h1><p>商品资料，为每一次创作提供真实依据。</p></div><div class="heading-actions"><a class="button button-plain" href="/api/products/template" download><ArrowDownToLine :size="15" />CSV 模板</a><button class="button button-plain" :disabled="importing" @click="csvInput?.click()"><ArrowUpFromLine :size="15" />{{ importing ? '正在导入' : '导入 CSV' }}</button><button class="button button-dark" @click="edit(null)"><Plus :size="16" />新增商品</button></div></header>
  <input ref="csvInput" class="visually-hidden" type="file" accept=".csv,text/csv" aria-label="导入商品 CSV 文件" @change="importCsv" />
  <section class="catalog-panel"><div class="list-toolbar"><span>{{ workspace.products.length }} 件商品</span><div class="search-modes" aria-label="商品搜索方式"><button :class="{ active: searchMode === 'keyword' }" :aria-pressed="searchMode === 'keyword'" @click="searchMode = 'keyword'">关键词</button><button :class="{ active: searchMode === 'semantic' }" :aria-pressed="searchMode === 'semantic'" @click="searchMode = 'semantic'"><Sparkles :size="13" />语义选品</button></div><form class="catalog-search" @submit.prevent="searchMode === 'semantic' && searchSemantically()"><label class="search-field"><Search :size="16" /><input v-model="search" :placeholder="searchMode === 'semantic' ? '例如：适合通勤的轻薄上衣' : '搜索名称、编码或品类'" aria-label="搜索本店商品" maxlength="100" /><button v-if="search" class="icon-button" type="button" aria-label="清空搜索" @click="search = ''"><X :size="13" /></button></label><button v-if="searchMode === 'semantic'" class="button button-dark" :disabled="searching || !searchReady || !search.trim()"><LoaderCircle v-if="searching" class="spin" :size="14" />{{ searching ? '正在选品' : '查找商品' }}</button></form></div>
    <div v-if="searchMode === 'semantic'" class="semantic-help"><label><input v-model="inStock" type="checkbox" />仅显示有库存的商品</label><span v-if="workspace.searchStatus?.state === 'preparing'">正在准备商品检索服务，首次加载需要一些时间。</span><span v-else-if="workspace.searchStatus?.state === 'ready' && workspace.searchStatus.pending">正在同步商品资料：{{ workspace.searchStatus.indexed }}/{{ workspace.searchStatus.total }}</span><span v-else-if="!searchReady">商品检索暂未就绪。<button class="text-button" :disabled="retrying" @click="retrySearch">{{ retrying ? '正在重试' : '重试连接与同步' }}</button><button class="text-button" @click="workspace.view = 'settings'">查看服务连接</button></span><span v-else-if="semanticResult">找到 {{ semanticResult.results.length }} 件商品，按相关性排列 · {{ semanticResult.elapsedMs }} ms</span><span v-else>描述用途、风格或材质，查找本店相关商品。</span></div>
    <div v-if="searchMode === 'semantic' && !semanticResult" class="empty-state"><Sparkles :size="38" :stroke-width="1" /><h2>{{ searching ? '正在理解选品要求' : '用一句话，找到合适的商品' }}</h2><p>输入使用场景、风格或面料要求，再点击“查找商品”。</p></div>
    <div v-else-if="!products.length" class="empty-state"><Package :size="38" :stroke-width="1" /><h2>{{ search ? '没有找到相关商品' : '从真实商品，开始创作' }}</h2><p>{{ search ? '调整关键词，查看本店的其他商品。' : '导入 CSV 商品资料，或新增第一件商品。' }}</p><button v-if="!search" class="button button-dark" @click="edit(null)"><Plus :size="15" />新增商品</button></div>
    <div v-else class="table-scroll"><table class="product-table"><thead><tr><th>商品</th><th>商品编码</th><th>品类与颜色</th><th>售价</th><th>可用库存</th><th><span class="visually-hidden">操作</span></th></tr></thead><tbody><tr v-for="item in products" :key="item.id"><td><div class="table-product"><img v-if="item.imageAssetId" :src="assetUrl(item.imageAssetId)" :alt="item.name" /><div v-else class="product-image-empty"><Package :size="20" /></div><div><strong>{{ item.name }}</strong><small>{{ item.material || '尚未填写材质' }}</small></div></div></td><td class="code-text">{{ item.sku }}</td><td>{{ item.category }}<small class="cell-secondary">{{ item.color }}</small></td><td>¥{{ (item.priceCents / 100).toFixed(2) }}</td><td><span :class="['stock-badge', { empty: item.stock === 0 }]">{{ item.stock === 0 ? '暂无库存' : item.stock }}</span></td><td><button class="icon-button" :aria-label="`编辑${item.name}`" @click="edit(item)"><Pencil :size="15" /></button></td></tr></tbody></table></div>
    <div class="csv-help">CSV 按商品编码更新资料；售价使用整数分，图片可在商品编辑中上传。</div>
  </section>
  <ModalShell :open="open" :title="editing ? '编辑商品资料' : '新增商品'" wide @close="open = false"><form class="product-form" @submit.prevent="save"><div class="form-two-columns"><div><label class="field-label">商品名称<input v-model="form.name" required maxlength="100" /></label><div class="field-pair"><label class="field-label">商品编码<input v-model="form.sku" required maxlength="64" /></label><label class="field-label">品类<input v-model="form.category" required maxlength="40" placeholder="例如：连衣裙" /></label></div><div class="field-pair"><label class="field-label">颜色<input v-model="form.color" maxlength="40" /></label><label class="field-label">材质<input v-model="form.material" maxlength="100" /></label></div><div class="field-pair"><label class="field-label">售价（元）<input v-model.number="form.price" type="number" min="0" step="0.01" required /></label><label class="field-label">库存数量<input v-model.number="form.stock" type="number" min="0" step="1" required /></label></div><label class="field-label">商品描述<textarea v-model="form.description" rows="3" maxlength="1500" placeholder="款式、面料与需要保留的商品细节" /></label></div><UploadCard v-model:asset-id="form.imageAssetId" kind="product" title="商品主图" caption="上传这件商品的图片" /></div><div class="modal-footer"><button class="button button-plain" type="button" @click="open = false">取消</button><button class="button button-dark" :disabled="busy">{{ busy ? '正在保存' : '保存商品资料' }}</button></div></form></ModalShell>
</template>

<style scoped>
.list-toolbar { flex-wrap: wrap; }
.search-modes { display: flex; gap: 4px; margin-left: auto; background: #f0f3e9; border-radius: 5px; padding: 3px; }
.search-modes button { display: inline-flex; align-items: center; gap: 5px; border: 0; background: transparent; color: #929d83; padding: 7px 10px; border-radius: 4px; font-size: 10px; }
.search-modes button.active { background: #fffefb; color: #536b40; box-shadow: 0 1px 3px #273a1510; }
.catalog-search { display: flex; align-items: center; gap: 8px; }
.catalog-search .button { font-size: 10px; padding: 9px 12px; white-space: nowrap; }
.semantic-help { display: flex; align-items: center; flex-wrap: wrap; gap: 14px; padding: 0 22px 17px; color: #8b977a; font-size: 10px; line-height: 1.8; }
.semantic-help label { display: inline-flex; align-items: center; gap: 7px; }
.semantic-help input { width: auto; accent-color: #66784c; }
.semantic-help .text-button { font-size: 10px; margin-left: 8px; }
@media (max-width: 850px) { .catalog-search { width: 100%; } .catalog-search .search-field { flex: 1; } }
</style>
