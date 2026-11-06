<script setup lang="ts">
import { computed } from "vue"
import Input from "./Input.vue"

/** Integer amount shown with thousands separators ("250 000"); the model is the plain digit string. */
const model = defineModel<string | number | undefined>()

const digits = (value: string): string => value.replace(/\D+/g, "")
const group = (value: string): string => value.replace(/\B(?=(\d{3})+(?!\d))/g, " ")

const shown = computed({
  get: () => group(digits(String(model.value ?? ""))),
  set: (next: string | number | undefined) => {
    model.value = digits(String(next ?? ""))
  }
})
</script>

<template>
  <Input v-model="shown" inputmode="numeric" autocomplete="off" />
</template>
