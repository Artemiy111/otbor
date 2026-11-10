<script setup lang="ts">
import { computed } from "vue"
import { useQuery } from "@pinia/colada"
import { vacancyApi, vacancyKeys } from "@/entities/vacancy"
import { vacancyPath } from "@/shared/lib"

const props = defineProps<{ id: string }>()

const query = useQuery({
  key: () => vacancyKeys.detail(props.id),
  query: () => vacancyApi.get(props.id)
})
const title = computed(() => query.data.value?.vacancy.title ?? null)
</script>

<template>
  <a
    :href="vacancyPath(id)"
    class="text-sm text-info underline-offset-4 hover:underline"
  >{{ title ?? "Вакансия" }}</a>
</template>
