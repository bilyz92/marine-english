import { defineConfig } from "prisma/config";

// Migration chạy bằng vai trò me_migrator; ứng dụng chạy bằng me_app (DATABASE_URL).
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.MIGRATOR_DATABASE_URL,
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
