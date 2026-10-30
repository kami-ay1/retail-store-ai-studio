import { ref } from 'vue'

/** 页面错误与操作结果的统一通知。 */
export const notice = ref<{ text: string; type: 'error' | 'success' } | null>(null)

/** 成功提示只在真实接口完成后触发。 */
export function notifySuccess(text: string) { notice.value = { text, type: 'success' } }
