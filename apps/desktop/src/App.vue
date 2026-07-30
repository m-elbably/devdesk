<script setup lang="ts">
import { RouterProvider } from '@tanstack/vue-router'
import { router } from './router'
</script>

<template>
  <UApp>
    <RouterProvider :router="router" />
  </UApp>
</template>
