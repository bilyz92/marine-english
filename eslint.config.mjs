import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Tham số/biến bắt đầu bằng "_" là cố ý không dùng (giữ chữ ký hợp đồng).
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Dự án: tài liệu, bản sao giao diện, mã Prisma sinh ra.
    "docs/**",
    "src/generated/**",
    ".superpowers/**",
  ]),
]);

export default eslintConfig;
