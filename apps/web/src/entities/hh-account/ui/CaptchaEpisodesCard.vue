<script setup lang="ts">
import { computed } from "vue"
import { useQuery } from "@pinia/colada"
import { queueJobApi, queueJobKeys } from "@/entities/queue-job"
import { describeError, formatDate } from "@/shared/lib"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui"
import { hhAccountApi } from "../api"
import CaptchaStatus from "./CaptchaStatus.vue"
import { captchaEpisodeText, hhAccountKeys, hhAccountNameById } from "../model"

/** Последние эпизоды капчи: после скольких откликов hh её показывает. */
const episodes = useQuery({
  key: () => hhAccountKeys.captchaEpisodes(),
  query: () => hhAccountApi.captchaEpisodes(10)
})
const accounts = useQuery({ key: () => hhAccountKeys.list(), query: () => hhAccountApi.list() })
const concurrency = useQuery({ key: () => queueJobKeys.concurrency(), query: () => queueJobApi.concurrency() })
const rows = computed(() => episodes.data.value ?? [])

defineExpose({ refetch: () => episodes.refetch() })
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Капча hh.ru</CardTitle>
      <CardDescription>
        Сколько откликов hh пропускает, прежде чем показать капчу. По этим цифрам можно задать «не больше N
        отправок за час» в настройках.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <ul v-if="concurrency.data.value" class="mb-3 space-y-1 text-sm">
        <li v-for="a in concurrency.data.value.accounts" :key="a.id">
          <span class="font-medium">{{ a.name }}</span> · <CaptchaStatus :account="a" />
        </li>
      </ul>
      <p v-if="episodes.error.value" class="text-sm text-destructive">{{ describeError(episodes.error.value) }}</p>
      <p v-else-if="rows.length === 0" class="text-sm text-muted-foreground">Капчи ещё не было.</p>
      <ul v-else class="space-y-1.5 text-sm">
        <li v-for="episode in rows" :key="episode.id" class="tabular-nums">
          <span class="font-medium">{{ hhAccountNameById(accounts.data.value ?? [], episode.hhAccountId) }}</span>
          · {{ captchaEpisodeText(episode) }}
          <span class="text-muted-foreground">
            ({{ formatDate(episode.captchaAt) }}<template v-if="!episode.resumedAt">, пауза, повтор сам</template>)
          </span>
        </li>
      </ul>
    </CardContent>
  </Card>
</template>
