<script setup lang="ts">
import { computed } from "vue"
import { useQuery } from "@pinia/colada"
import { companyApi, companyKeys } from "@/entities/company"
import { companyPath } from "@/shared/lib"

const props = defineProps<{ id: string | null }>()

const query = useQuery({
  key: () => companyKeys.detail(props.id ?? ""),
  query: () => companyApi.get(props.id ?? ""),
  enabled: () => props.id !== null
})
const name = computed(() => query.data.value?.employer.name ?? null)
</script>

<template>
  <span v-if="id === null" class="text-muted-foreground">—</span>
  <a
    v-else
    :href="companyPath(id)"
    class="text-sm text-sky-700 underline-offset-4 hover:underline dark:text-sky-300"
  >{{ name ?? "Компания" }}</a>
</template>
