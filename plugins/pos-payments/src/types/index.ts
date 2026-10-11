/**
 * Opcoes do plugin. Fase 1 (provider manual/terminal-presente) nao exige nada:
 * as credenciais de adquirente chegam por adapter nas fases seguintes e vivem
 * SEMPRE no backend (nunca no app de caixa).
 */
export type PosPaymentsPluginOptions = {
  /** Ambientes sandbox por adquirente (futuro). */
  sandbox?: boolean
  /**
   * Adapter das rotas admin (§6.3) — espelha as options do provider no
   * medusa-config (providers do módulo payment não são resolvíveis do
   * container; verificado no @medusajs/payment 2.19). Ausente/manual: as
   * rotas de charges/terminals respondem NOT_ALLOWED.
   */
  posTerminal?: {
    acquirer?: string
    accessToken?: string
    /** Secret de assinatura do webhook no DevPanel (T5) — espelha o provider. */
    webhookSecret?: string
    /** Guard MP_POINT_TEST_MODE (T6) — espelha o provider: default false. */
    mpPointTestMode?: boolean
    /** Seam de teste — fetch injetado (produção usa o global). */
    fetchImpl?: typeof fetch
  }
  /**
   * Onboarding (Fase 2b, onboarding.md §5.2): config de PLATAFORMA (do deploy,
   * não do lojista). Env tem precedência: POS_PAYMENTS_MP_CLIENT_ID/SECRET/
   * REDIRECT_URI. Master key da credencial: POS_PAYMENTS_MASTER_KEY (env).
   */
  onboarding?: {
    mercadopago?: {
      clientId?: string
      clientSecret?: string
      redirectUri?: string
      /** test_token=true na troca (sandbox). Env: POS_PAYMENTS_MP_OAUTH_TEST_TOKEN. */
      testToken?: boolean
      /** Seam de teste — fetch injetado (produção usa o global). */
      fetchImpl?: typeof fetch
    }
  }
}

// Contrato do session data do provider (ADR 0002: contrato sai por ./types)
export type { PosTerminalSessionData } from "../providers/pos-terminal/schema"
