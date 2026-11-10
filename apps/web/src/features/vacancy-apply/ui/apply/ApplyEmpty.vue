<script setup lang="ts">
/** Нечем откликаться: нет аккаунта hh или у аккаунта нет резюме. Объясняет, что сделать. */
defineProps<{ reason: "no-accounts" | "no-resumes" }>()
</script>

<template>
  <div class="space-y-2 rounded-md border border-dashed border-border p-4 text-sm">
    <template v-if="reason === 'no-accounts'">
      <p class="font-medium">Не подключён ни один аккаунт hh</p>
      <p class="text-muted-foreground">
        Чтобы откликаться, подключите аккаунт на странице
        <a href="/accounts" class="text-primary underline-offset-4 hover:underline">«Аккаунты hh»</a>.
      </p>
    </template>
    <template v-else>
      <p class="font-medium">У выбранного аккаунта нет резюме</p>
      <p class="text-muted-foreground">
        Загрузите резюме на странице
        <a href="/resumes" class="text-primary underline-offset-4 hover:underline">«Резюме»</a>
        или выберите другой аккаунт. Отклик отправляется с конкретным резюме.
      </p>
    </template>
  </div>
</template>
