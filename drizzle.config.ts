// Конфиг нужен только Drizzle Studio (read-only просмотр таблиц).
// Миграции пишутся руками в packages/cloud/migrations и применяются
// effect/sql/Migrator, поэтому drizzle-kit generate/push здесь не используется.
// drizzle-kit в репозиторий не ставится (он живёт в контейнере Studio), поэтому
// без defineConfig.
export default {
  dialect: "postgresql",
  schema: "./packages/cloud/src/db/tables.ts",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://otbor:otbor@localhost:55432/otbor"
  }
}
