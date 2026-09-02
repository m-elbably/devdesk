<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from '@tanstack/vue-router'

const router = useRouter()
onMounted(() => void router.navigate({ to: '/notes' as never, replace: true }))
</script>

<template><span class="sr-only">Opening Notes…</span></template>
