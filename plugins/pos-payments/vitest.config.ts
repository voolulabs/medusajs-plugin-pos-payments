import { defineConfig } from "vitest/config"

// Specs vivem só em src/**/__tests__ — o output do build (.medusa/server) e
// dist nunca entram na suíte (rodavam duas vezes e o .js compilado falhava).
//
// Cobertura (régua da casa): include explícito porque o default do vitest só
// mostra arquivos importados — sem ele plugin-options/health não aparecem no
// relatório (nem no Codecov). Reporter lcov declarado para o upload; text
// para o terminal. Thresholds falham abaixo da régua no CI: global 90%,
// money paths (provider) 95%.
export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.spec.ts"],
    exclude: ["**/node_modules/**", "**/.medusa/**", "**/dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/__tests__/**",
        "src/types/**",
        "src/admin/index.ts",
        "src/modules/**/migrations/**",
      ],
      thresholds: {
        lines: 90,
        branches: 90,
        functions: 90,
        statements: 90,
        "src/providers/pos-terminal/**": {
          lines: 95,
          branches: 95,
        },
      },
    },
  },
})
