<script setup lang="ts">
import { ref } from "vue"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"
import ContactsPanel from "./ContactsPanel.vue"
import ConversationsPanel from "./ConversationsPanel.vue"

const tab = ref("contacts")
</script>

<template>
  <section>
    <PageHeader
      title="Переписка"
      description="Люди, которых можно найти по вакансиям, почте и Telegram. Контакт — это способ связи, а не человек."
    />

    <Tabs v-model="tab" class="gap-4">
      <TabsList>
        <TabsTrigger value="contacts">Контакты</TabsTrigger>
        <TabsTrigger value="conversations">Диалоги</TabsTrigger>
      </TabsList>

      <TabsContent value="contacts">
        <ContactsPanel />
      </TabsContent>
      <TabsContent value="conversations">
        <ConversationsPanel />
      </TabsContent>
    </Tabs>
  </section>
</template>
