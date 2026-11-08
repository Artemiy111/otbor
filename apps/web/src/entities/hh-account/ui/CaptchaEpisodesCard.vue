<script setup lang="ts">
import { computed } from "vue"
import { useQuery } from "@pinia/colada"
import { describeError, formatDate } from "@/shared/lib"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui"
import { hhAccountApi } from "../api"
import { captchaEpisodeText, hhAccountKeys, hhAccountNameById } from "../model"

/** Последние эпизоды капчи: после скольких откликов hh её показывает. */
const episodes = useQuery({
  key: () => hhAccountKeys.captchaEpisodes(),
  query: () => hhAccountApi.captchaEpisodes(10)
})
const accounts = useQuery({ key: () => hhAccountKeys.list(), query: () => hhAccountApi.list() })
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
      <p v-if="episodes.error.value" class="text-sm text-destructive">{{ describeError(episodes.error.value) }}</p>
      <p v-else-if="rows.length === 0" class="text-sm text-muted-foreground">Капчи ещё не было.</p>
      <ul v-else class="space-y-1.5 text-sm">
        <li v-for="episode in rows" :key="episode.id" class="tabular-nums">
          <span class="font-medium">{{ hhAccountNameById(accounts.data.value ?? [], episode.hhAccountId) }}</span>
          · {{ captchaEpisodeText(episode) }}
          <span class="text-muted-foreground">
            ({{ formatDate(episode.captchaAt) }}<template v-if="!episode.resumedAt">, ждёт вашего «Продолжить»</template>)
          </span>
        </li>
      </ul>
    </CardContent>
  </Card>
</template>
