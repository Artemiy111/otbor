<script setup lang="ts">
import { computed, ref } from "vue"
import { useQuery } from "@pinia/colada"
import { CircleAlert } from "@lucide/vue"
import { presetApi, presetKeys } from "@/entities/preset"
import { RefreshButton } from "@/features/refresh-button"
import {
  describeError,
  formatDate,
  payloadPreview,
  payloadText,
  presetKindLabel
} from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Card,
  CardContent,
  EmptyState,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"

const kind = ref("all")

const query = useQuery({
  key: () => presetKeys.list(kind.value),
  query: () =>
    presetApi.list({
      kind: kind.value === "all" ? undefined : kind.value
    })
})

const presets = computed(() => query.data.value ?? [])
</script>

<template>
  <section>
    <PageHeader
      title="Пресеты"
      description="Сохранённые фильтры корпуса: что искать и по каким правилам откликаться."
    >
      <template #actions>
        <RefreshButton :loading="query.isLoading.value" @refresh="query.refetch()" />
      </template>
    </PageHeader>

    <div class="mb-4 flex flex-wrap items-end gap-3">
      <div class="space-y-1.5">
        <Label for="preset-kind" class="text-xs text-muted-foreground">Тип</Label>
        <Select v-model="kind">
          <SelectTrigger id="preset-kind" class="w-[190px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все типы</SelectItem>
            <SelectItem value="explore">Поиск (explore)</SelectItem>
            <SelectItem value="apply">Отклики (apply)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <span class="pb-2 text-xs text-muted-foreground">Пресетов: {{ presets.length }}</span>
    </div>

    <Alert v-if="query.error.value" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить пресеты</AlertTitle>
      <AlertDescription>{{ describeError(query.error.value) }}</AlertDescription>
    </Alert>

    <Card>
      <CardContent class="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Название</TableHead>
              <TableHead>Тип</TableHead>
              <TableHead>Системный</TableHead>
              <TableHead>Фильтр</TableHead>
              <TableHead>Обновлён</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <template v-if="query.isPending.value">
              <TableRow v-for="index in 6" :key="index">
                <TableCell :colspan="5">
                  <Skeleton class="h-4 w-full" />
                </TableCell>
              </TableRow>
            </template>

            <TableRow v-else-if="presets.length === 0">
              <TableCell :colspan="5">
                <EmptyState
                  title="Пресетов нет"
                  description="Создайте пресет через CLI, чтобы фильтровать корпус и поток откликов."
                />
              </TableCell>
            </TableRow>

            <TableRow v-for="preset in presets" :key="preset.id">
              <TableCell class="max-w-[320px]">
                <div class="font-medium">{{ preset.title }}</div>
                <code class="text-[11px] text-muted-foreground">{{ preset.id }}</code>
              </TableCell>
              <TableCell>
                <Badge :variant="preset.kind === 'apply' ? 'info' : 'secondary'">
                  {{ presetKindLabel(preset.kind) }}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge :variant="preset.system ? 'outline' : 'neutral'">
                  {{ preset.system ? "системный" : "пользовательский" }}
                </Badge>
              </TableCell>
              <TableCell class="max-w-[420px]">
                <details>
                  <summary class="cursor-pointer font-mono text-xs text-muted-foreground">
                    {{ payloadPreview(preset.filter) }}
                  </summary>
                  <pre
                    class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2 text-[11px]"
                  >{{ payloadText(preset.filter) }}</pre>
                </details>
              </TableCell>
              <TableCell class="whitespace-nowrap text-muted-foreground">
                {{ formatDate(preset.updatedAt) }}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </section>
</template>
