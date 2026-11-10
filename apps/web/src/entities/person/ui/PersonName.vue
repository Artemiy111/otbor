<script setup lang="ts">
import { computed } from "vue"
import { useQuery } from "@pinia/colada"
import { personApi, personKeys } from "@/entities/person"
import { personPath } from "@/shared/lib"

const props = defineProps<{ id: string }>()

const query = useQuery({
  key: () => personKeys.detail(props.id),
  query: () => personApi.get(props.id)
})
const label = computed(() => {
  const person = query.data.value
  if (!person) return "Человек"
  return [person.displayName ?? "Без имени", person.role].filter(Boolean).join(" · ")
})
</script>

<template>
  <a
    :href="personPath(id)"
    class="text-sm font-medium text-info underline-offset-4 hover:underline"
  >{{ label }}</a>
</template>
