<script setup lang="ts">
import { apiEndpoint } from "@/shared/api"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui"
import AnalysisToggleCard from "./AnalysisToggleCard.vue"
import ApplySettingsCard from "./ApplySettingsCard.vue"
import CaptchaSolverCard from "./CaptchaSolverCard.vue"
import LocalModelsCard from "./LocalModelsCard.vue"
import ProxyCard from "./ProxyCard.vue"
import { PageHeader } from "@/widgets/page-header"
</script>

<template>
  <section>
    <PageHeader
      title="Настройки"
      description="Параметры кабинета. Прокси и локальные модели хранятся локально на сервере."
    />

    <p class="-mt-3 mb-6 text-sm text-muted-foreground">
      Основной аккаунт и вход в hh.ru — на странице
      <a href="/accounts" class="text-primary underline-offset-4 hover:underline">«Аккаунты hh»</a>.
    </p>

    <div class="grid items-start gap-x-6 gap-y-8 xl:grid-cols-2">
      <div class="min-w-0 space-y-8">
        <section class="space-y-3" aria-labelledby="settings-send">
          <h2 id="settings-send" class="text-base font-semibold">Отправка и темп</h2>
          <ApplySettingsCard />
        </section>

        <section class="space-y-3" aria-labelledby="settings-network">
          <h2 id="settings-network" class="text-base font-semibold">Сеть и прокси</h2>
          <ProxyCard />
        </section>
      </div>

      <div class="min-w-0 space-y-8">
        <section class="space-y-3" aria-labelledby="settings-models">
          <h2 id="settings-models" class="text-base font-semibold">Модели и капча</h2>
          <AnalysisToggleCard />
          <LocalModelsCard />
          <CaptchaSolverCard />
        </section>

        <section class="space-y-3" aria-labelledby="settings-server">
          <h2 id="settings-server" class="text-base font-semibold">Сервер</h2>
          <Card>
            <CardHeader>
              <CardTitle>Подключение</CardTitle>
              <CardDescription>Адрес API, к которому обращается кабинет.</CardDescription>
            </CardHeader>
            <CardContent>
              <code class="font-mono text-sm">{{ apiEndpoint }}</code>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  </section>
</template>
