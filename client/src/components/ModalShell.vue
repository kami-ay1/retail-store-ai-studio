<script setup lang="ts">
import { ref, useId, watch } from 'vue'
import { X } from 'lucide-vue-next'
const props = defineProps<{ open: boolean; title: string; wide?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const titleId = useId()
watch(() => props.open, value => {
  if (!dialog.value) return
  if (value) dialog.value.showModal()
  else dialog.value.close()
}, { flush: 'post' })
</script>

<template>
  <dialog ref="dialog" :class="['modal', { 'modal-wide': wide }]" :aria-labelledby="titleId" @cancel.prevent="emit('close')" @click="event => { if (event.target === dialog) emit('close') }">
    <div class="modal-head"><h2 :id="titleId">{{ title }}</h2><button class="icon-button" aria-label="关闭弹窗" @click="emit('close')"><X :size="20" /></button></div>
    <slot />
  </dialog>
</template>
