<script setup lang="ts">
import { useQuery } from "@pinia/colada"
import { CircleAlert } from "lucide-vue-next"
import { healthApi, healthKeys } from "@/entities/health"
import { RefreshButton } from "@/features/refresh-button"
import { describeError, formatDate } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Skeleton,
  StatusBadge
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"
import { StatCard } from "@/widgets/stat-card"

const { data, isPending, isLoading, error, refetch } = useQuery({
  key: healthKeys.current(),
  query: healthApi.get
})
</script>

<template>
  <section>
    <PageHeader title="Health" description="Cloud RPC status and database connectivity.">
      <template #actions>
        <RefreshButton :loading="isLoading" @refresh="refetch()" />
      </template>
    </PageHeader>

    <Alert v-if="error" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>RPC unavailable</AlertTitle>
      <AlertDescription>
        <p>{{ describeError(error) }}</p>
        <p class="mt-1 text-xs opacity-80">
          Start the server with <code>bun run server</code>.
        </p>
      </AlertDescription>
    </Alert>

    <div v-if="isPending" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Skeleton v-for="index in 4" :key="index" class="h-24 w-full" />
    </div>

    <div v-else-if="data" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard label="Status">
        <StatusBadge :value="data.status" />
      </StatCard>
      <StatCard label="Database">
        <StatusBadge :value="data.database ? 'ok' : 'down'" />
      </StatCard>
      <StatCard label="Version" :value="data.version" mono />
      <StatCard label="Server time" :value="formatDate(data.now)" />
    </div>
  </section>
</template>
