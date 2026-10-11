/** Config de plataforma do onboarding (onboarding.md §5.2): são do DEPLOY,
 * não do lojista — env em primeiro lugar, options do plugin como fallback.
 * Presence-gated: sem config, as rotas OAuth respondem erro tipado (§1.1). */
import type { PosPaymentsPluginOptions } from "./index"
import { OnboardingError } from "../services/onboarding/errors"

export interface MpOnboardingConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  testToken: boolean
}

function envOr(
  env: Record<string, string | undefined>,
  envKey: string,
  value: string | undefined
): string | undefined {
  const v = env[envKey]
  return v ? v : value
}

/** Resolve MP clientId/secret/redirect — OnboardingError "platform_config"
 * (400) se faltar peça; nunca segue com config parcial. */
export function mpOnboardingConfig(
  env: Record<string, string | undefined>,
  options: PosPaymentsPluginOptions | undefined
): MpOnboardingConfig {
  const mp = options?.onboarding?.mercadopago
  const clientId = envOr(env, "POS_PAYMENTS_MP_CLIENT_ID", mp?.clientId)
  const clientSecret = envOr(
    env,
    "POS_PAYMENTS_MP_CLIENT_SECRET",
    mp?.clientSecret
  )
  const redirectUri = envOr(
    env,
    "POS_PAYMENTS_MP_REDIRECT_URI",
    mp?.redirectUri
  )
  const missing = [
    ...(clientId ? [] : ["POS_PAYMENTS_MP_CLIENT_ID"]),
    ...(clientSecret ? [] : ["POS_PAYMENTS_MP_CLIENT_SECRET"]),
    ...(redirectUri ? [] : ["POS_PAYMENTS_MP_REDIRECT_URI"]),
  ]
  if (missing.length) {
    throw new OnboardingError(
      "platform_config",
      400,
      `configuração de plataforma ausente: ${missing.join(", ")}`
    )
  }
  return {
    clientId: clientId as string,
    clientSecret: clientSecret as string,
    redirectUri: redirectUri as string,
    testToken:
      env.POS_PAYMENTS_MP_OAUTH_TEST_TOKEN === "true" || mp?.testToken === true,
  }
}
