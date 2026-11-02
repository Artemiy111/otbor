<script setup lang="ts">
import { computed, ref } from "vue"
import type { HarnessJob } from "@otbor/contract"
import { CircleAlert } from "@lucide/vue"
import { describeError } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Textarea
} from "@/shared/ui"
import { useInferenceEnqueue } from "../model/use-inference-enqueue"

const props = defineProps<{ busy?: boolean }>()
const emit = defineEmits<{ enqueued: [job: HarnessJob] }>()

const prompt = ref("")
const system = ref("")
const model = ref("")
const validationError = ref<string | null>(null)

const { mutateAsync, isLoading, error } = useInferenceEnqueue()

const disabled = computed(() => props.busy === true || isLoading.value)
const errorText = computed(() => {
  if (validationError.value !== null) return validationError.value
  return error.value === null ? null : describeError(error.value)
})

const submit = async () => {
  const text = prompt.value.trim()
  if (text === "") {
    validationError.value = "Введите запрос."
    return
  }

  validationError.value = null
  try {
    const enqueued = await mutateAsync({
      prompt: text,
      system: system.value.trim() === "" ? undefined : system.value.trim(),
      model: model.value.trim() === "" ? undefined : model.value.trim()
    })
    emit("enqueued", enqueued.job)
  } catch {
    // The mutation error is rendered below.
  }
}

const reset = () => {
  prompt.value = ""
  system.value = ""
  model.value = ""
  validationError.value = null
}

defineExpose({ reset })
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Запрос</CardTitle>
      <CardDescription>
        Задание уйдёт в очередь harness. Модель вызовет ACP-агент, а не облако.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <form class="space-y-4" @submit.prevent="submit">
        <Alert v-if="errorText" variant="destructive">
          <CircleAlert />
          <AlertTitle>Не удалось поставить задание</AlertTitle>
          <AlertDescription>{{ errorText }}</AlertDescription>
        </Alert>

        <div class="space-y-2">
          <Label for="inference-prompt">Запрос</Label>
          <Textarea
            id="inference-prompt"
            v-model="prompt"
            rows="8"
            placeholder="Спросите модель harness о чём-нибудь…"
            :disabled="disabled"
          />
        </div>

        <div class="grid gap-4 md:grid-cols-2">
          <div class="space-y-2">
            <Label for="inference-system">
              Системная инструкция
              <span class="font-normal text-muted-foreground">необязательно</span>
            </Label>
            <Textarea
              id="inference-system"
              v-model="system"
              rows="3"
              placeholder="Дополнительные указания для этого запуска"
              :disabled="disabled"
            />
          </div>

          <div class="space-y-2">
            <Label for="inference-model">
              Модель
              <span class="font-normal text-muted-foreground">необязательно</span>
            </Label>
            <Input
              id="inference-model"
              v-model="model"
              type="text"
              placeholder="provider/model"
              :disabled="disabled"
            />
            <p class="text-xs text-muted-foreground">
              Только подсказка: побеждает модель, записанная в ACP-сессии.
            </p>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <Button type="submit" :disabled="disabled">
            {{ isLoading ? "Ставим в очередь…" : props.busy ? "Ждём ответ…" : "Запустить генерацию" }}
          </Button>
          <span v-if="props.busy" class="text-xs text-muted-foreground">
            Опрос раз в секунду, до 180 с.
          </span>
        </div>
      </form>
    </CardContent>
  </Card>
</template>
