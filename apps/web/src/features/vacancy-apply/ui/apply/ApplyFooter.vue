<script setup lang="ts">
import { computed } from "vue"
import { LoaderCircle, Send } from "@lucide/vue"
import { applicationPath, cn, formatDate, toneClasses } from "@/shared/lib"
import { Button } from "@/shared/ui"
import { draftStateText } from "../../lib/formState"

/**
 * Липкий низ панели: состояние черновика словами и два действия. Отправка
 * подтверждается тут же, в этой же строке; само действие делает панель.
 */
const props = defineProps<{
  busy: "refresh" | "save" | "send" | null
  canAct: boolean
  dirty: boolean
  savedAt: string | null
  hasSaved: boolean
  missing: ReadonlyArray<string>
  applicationId: string | null
}>()
const confirming = defineModel<boolean>("confirming", { required: true })
const emit = defineEmits<{ save: []; send: []; revert: [] }>()

const draft = computed(() => draftStateText({ dirty: props.dirty, savedAt: props.savedAt }))
</script>

<template>
  <footer class="space-y-2 border-t border-border bg-card px-4 py-3">
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" role="status">
      <span :class="cn(toneClasses(draft.tone).text)" :title="savedAt ? formatDate(savedAt) : undefined">{{ draft.text }}</span>
      <Button v-if="dirty && hasSaved" variant="link" size="sm" class="h-auto p-0 text-xs" :disabled="busy !== null" @click="emit('revert')">
        Вернуть сохранённое
      </Button>
      <a
        v-if="applicationId"
        :href="applicationPath(applicationId)"
        class="ml-auto rounded-sm text-muted-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
      >Подробности отклика</a>
    </div>
    <p v-if="missing.length > 0" class="text-xs text-warning">Не заполнено: {{ missing.join(", ") }}.</p>

    <div v-if="!confirming" class="flex flex-wrap items-center gap-2">
      <Button variant="outline" class="flex-1" :disabled="busy !== null || !canAct" @click="emit('save')">
        <LoaderCircle v-if="busy === 'save'" class="size-4 animate-spin" />
        Сохранить черновик
      </Button>
      <Button class="flex-1" :disabled="busy !== null || !canAct || missing.length > 0" @click="confirming = true">
        <Send class="size-4" />
        Отправить отклик
      </Button>
    </div>
    <div v-else class="space-y-2">
      <p class="text-sm">Анкета прочитается заново, отклик уйдёт на hh.ru. Отменить отправку нельзя.</p>
      <div class="flex flex-wrap items-center gap-2">
        <Button variant="destructive" class="flex-1" :disabled="busy !== null" @click="emit('send')">
          <LoaderCircle v-if="busy === 'send'" class="size-4 animate-spin" />
          Да, отправить
        </Button>
        <Button variant="ghost" :disabled="busy !== null" @click="confirming = false">Отмена</Button>
      </div>
    </div>
  </footer>
</template>
