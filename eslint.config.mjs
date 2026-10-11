// Padrão da comunidade Medusa (docs.medusajs.com/resources/lint, medusa-starter-plugin):
// flat config com o preset `recommended` do @medusajs/eslint-plugin — regras de
// convenção do framework (rotas, middlewares, services, workflows), zero-config,
// sem exigir type information. Acréscimo da casa: `no-floating-promises`
// type-aware apenas em plugins/pos-payments/src (código de dinheiro — promise
// solta em refund/capture é bug de pagamento). src/admin/** (UI) fica FORA do
// bloco type-aware: compila pelo admin-bundler com JSX (ADR 0004).
import { defineConfig } from "eslint/config"
import medusa from "@medusajs/eslint-plugin"
import tseslint from "typescript-eslint"

export default defineConfig([
  {
    ignores: [
      "**/.medusa/**",
      "**/dist/**",
      "**/coverage/**",
      "**/node_modules/**",
    ],
  },
  ...medusa.configs.recommended,
  {
    files: ["plugins/pos-payments/src/**/*.ts"],
    ignores: ["plugins/pos-payments/src/admin/**"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: ["./plugins/pos-payments/tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      // Herda a disciplina de type-only imports que a ADR 0002 atribuía ao
      // Biome (style.useImportType) antes da errata 2026-10-02.
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
])
