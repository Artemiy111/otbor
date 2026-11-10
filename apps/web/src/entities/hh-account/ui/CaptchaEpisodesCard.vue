<script setup lang="ts">
import { computed } from "vue"
import { useQuery } from "@pinia/colada"
import { describeError, formatDate } from "@/shared/lib"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui"
import { hhAccountApi } from "../api"
import { captchaEpisodeText, hhAccountKeys, hhAccountNameById } from "../model"

/** История капчи: после скольких откликов hh.ru её показывает. */
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
      <CardTitle>История капчи</CardTitle>
      <CardDescription>
        Иногда hh.ru просит пройти проверку «я не робот» и отправки ставятся на паузу. Здесь видно, после скольких
        откликов это случалось: по этим цифрам можно задать «не больше N отправок за час» в настройках.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <p v-if="episodes.error.value" class="text-sm text-destructive">{{ describeError(episodes.error.value) }}</p>
      <p v-else-if="episodes.isPending.value" class="text-sm text-muted-foreground">Загружаю…</p>
      <p v-else-if="rows.length === 0" class="text-sm text-muted-foreground">Капчи ещё не было.</p>
      <ul v-else class="divide-y text-sm">
        <li v-for="episode in rows" :key="episode.id" class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2 first:pt-0 last:pb-0">
          <span>
            <span class="font-medium">{{ hhAccountNameById(accounts.data.value ?? [], episode.hhAccountId) }}</span>
            <span class="text-muted-foreground"> · {{ captchaEpisodeText(episode) }}</span>
          </span>
          <span class="text-xs tabular-nums text-muted-foreground">
            {{ formatDate(episode.captchaAt) }}<template v-if="!episode.resumedAt"> · пауза, повторим сами</template>
          </span>
        </li>
      </ul>
    </CardContent>
  </Card>
</template>
