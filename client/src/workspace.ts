import { reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import { z } from 'zod'
import { agentRunSchema, assetSchema, generationSchema, integrationSchema, productSchema, productSearchStatusSchema, sessionSchema, type AgentRun, type Asset, type Generation, type MerchantSession, type OutfitPlan, type Product } from '../../shared/contracts.ts'
import { requestApi } from './api.ts'
import { notice } from './notifications.ts'

/** 商家工作台共享状态，账号切换时使旧查询与事件失效。 */
export const useWorkspace = defineStore('workspace', () => {
  const session = ref<MerchantSession | null>(null)
  const products = ref<Product[]>([]), assets = ref<Asset[]>([]), generations = ref<Generation[]>([]), agentRuns = ref<AgentRun[]>([])
  const integration = ref<z.output<typeof integrationSchema>>({ imageReady: false, agentReady: false, workflowId: null, botId: null, workflowPublished: false, agentPublished: false })
  const searchStatus = ref<z.output<typeof productSearchStatusSchema> | null>(null)
  const view = ref<'studio' | 'catalog' | 'library' | 'history' | 'settings'>('studio')
  const adoptedPlanId = ref<string | null>(null)
  const connected = ref(false)
  const activeGenerationId = ref<string | null>(null)
  const draft = reactive<{ productId: string; modelAssetId: string | null; productAssetId: string | null; scene: string; style: string; instructions: string }>({ productId: '', modelAssetId: null, productAssetId: null, scene: '自然光的日常通勤场景', style: '简洁真实的电商摄影', instructions: '' })
  let scope = 0
  let events: EventSource | undefined
  const entityVersions = new Map<string, number>()

  async function load() {
    const version = scope
    const values = await Promise.all([
      requestApi('/products', z.array(productSchema)), requestApi('/assets', z.array(assetSchema)),
      requestApi('/generations', z.array(generationSchema)), requestApi('/agent/runs', z.array(agentRunSchema)), requestApi('/integration', integrationSchema), requestApi('/products/search-index', productSearchStatusSchema),
    ])
    if (version !== scope) return
    products.value = values[0]; assets.value = values[1]; generations.value = values[2]; agentRuns.value = values[3]; integration.value = values[4]; searchStatus.value = values[5]
  }

  /** 查询状态时保留账户范围，避免账号切换后写入上一商家的索引数量。 */
  async function refreshSearchStatus() {
    const version = scope
    const result = await requestApi('/products/search-index', productSearchStatusSchema)
    if (version === scope) searchStatus.value = result
  }

  function connect() {
    const version = scope
    events?.close()
    events = new EventSource('/api/events')
    events.onopen = () => { if (version === scope) connected.value = true }
    events.onerror = () => { if (version === scope) connected.value = false }
    events.addEventListener('workspace', (event: MessageEvent<string>) => {
      const value = z.object({ id: z.number(), entityId: z.string(), entityType: z.enum(['agent', 'generation']) }).parse(JSON.parse(event.data))
      entityVersions.set(value.entityId, value.id)
      const update = async () => {
        if (value.entityType === 'agent') {
          const run = await requestApi(`/agent/runs/${value.entityId}`, agentRunSchema)
          if (version !== scope || entityVersions.get(value.entityId) !== value.id) return
          agentRuns.value = [run, ...agentRuns.value.filter(item => item.id !== run.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        } else {
          const task = await requestApi(`/generations/${value.entityId}`, generationSchema)
          if (version !== scope || entityVersions.get(value.entityId) !== value.id) return
          generations.value = [task, ...generations.value.filter(item => item.id !== task.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          if (task.status === 'succeeded') {
            const refreshedAssets = await requestApi('/assets', z.array(assetSchema))
            // 素材读取也可能跨越账号切换，提交结果前再次核验查询范围。
            if (version !== scope || entityVersions.get(value.entityId) !== value.id) return
            assets.value = refreshedAssets
          }
        }
      }
      void update().then(undefined, (error: unknown) => {
        if (version === scope) notice.value = { text: error instanceof Error ? error.message : '状态更新失败', type: 'error' }
      })
    })
  }

  async function authenticate(account: MerchantSession) {
    scope += 1
    const version = scope
    session.value = account
    await load()
    if (version !== scope || !session.value) return
    connect()
  }

  async function restore() {
    const response = await fetch('/api/auth/session')
    if (response.status === 401) return
    if (!response.ok) throw new Error('商家会话读取失败')
    await authenticate(sessionSchema.parse(await response.json()))
  }

  async function logout() {
    await requestApi('/auth/logout', z.object({ success: z.boolean() }), { method: 'POST' })
    scope += 1
    events?.close(); events = undefined; connected.value = false
    session.value = null; products.value = []; assets.value = []; generations.value = []; agentRuns.value = []; adoptedPlanId.value = null; activeGenerationId.value = null
    searchStatus.value = null
    draft.productId = ''; draft.modelAssetId = null; draft.productAssetId = null
    entityVersions.clear()
  }

  function selectProduct(id: string) {
    draft.productId = id
    draft.productAssetId = products.value.find(item => item.id === id)?.imageAssetId ?? null
    adoptedPlanId.value = null
  }

  function adoptPlan(plan: OutfitPlan) {
    selectProduct(plan.productId)
    draft.scene = plan.scene; draft.style = plan.style; draft.instructions = plan.instructions
    adoptedPlanId.value = plan.id
    view.value = 'studio'
  }

  return { session, products, assets, generations, agentRuns, integration, searchStatus, view, adoptedPlanId, connected, activeGenerationId, draft, load, refreshSearchStatus, authenticate, restore, logout, selectProduct, adoptPlan }
})
