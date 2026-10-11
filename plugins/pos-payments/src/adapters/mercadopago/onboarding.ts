/** OAuth + validação da conexão MP (mercado-pago.md §2; onboarding.md §6.1).
 * Config de plataforma (clientId/secret/redirect) vem de options/env — nunca
 * do lojista; tokens do lojista nunca em resposta/log (§8). */
import type { OAuthSecret } from "../../services/onboarding/credentials"
import { OnboardingError } from "../../services/onboarding/errors"
import type { OnboardingHttpClient } from "./onboarding-client"

interface MpPlatformConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  /** Credenciais de teste (sandbox): test_token=true na troca. */
  testToken?: boolean
}

/** auth.mercadopago.com/authorization — full-page redirect (ADR 0004). */
export function authorizeUrl(cfg: MpPlatformConfig, state: string): string {
  const qs = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    redirect_uri: cfg.redirectUri,
    state,
  })
  return `https://auth.mercadopago.com/authorization?${qs.toString()}`
}

function tokenForm(
  cfg: MpPlatformConfig,
  extra: Record<string, string>
): URLSearchParams {
  const form = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    ...extra,
  })
  if (cfg.testToken) form.set("test_token", "true")
  return form
}

interface MpTokenResponse {
  access_token?: unknown
  refresh_token?: unknown
  expires_in?: unknown
}

function parseTokenPair(body: unknown): OAuthSecret {
  const t = (body ?? {}) as MpTokenResponse
  if (typeof t.access_token !== "string" || !t.access_token) {
    throw new OnboardingError(
      "invalid_credential",
      502,
      "resposta de token inválida"
    )
  }
  return {
    access_token: t.access_token,
    ...(typeof t.refresh_token === "string"
      ? { refresh_token: t.refresh_token }
      : {}),
    ...(typeof t.expires_in === "number"
      ? { expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString() }
      : {}),
  }
}

/** Troca do code (10 min, uso único) — urlencoded (guia oficial de marketplace). */
export async function exchangeCode(
  http: OnboardingHttpClient,
  cfg: MpPlatformConfig,
  code: string
): Promise<OAuthSecret> {
  const { body } = await http.request("POST", "/oauth/token", {
    form: tokenForm(cfg, { grant_type: "authorization_code", code }),
  })
  return parseTokenPair(body)
}

/** Refresh: pode rotacionar — o PAR volta inteiro e é gravado atômicamente. */
export async function refreshOnboardingToken(
  http: OnboardingHttpClient,
  cfg: MpPlatformConfig,
  refreshToken: string
): Promise<OAuthSecret> {
  let body: unknown
  try {
    ;({ body } = await http.request("POST", "/oauth/token", {
      form: tokenForm(cfg, {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    }))
  } catch (err) {
    const e = err as { status?: number; mpError?: string }
    if (
      e.status === 400 &&
      (e.mpError === "invalid_grant" || e.mpError === "bad_request")
    ) {
      throw new OnboardingError(
        "reauthorize",
        409,
        "refresh recusado — reconectar"
      )
    }
    throw err
  }
  return parseTokenPair(body)
}

/** Chamada real barata que prova a credencial (validate-then-activate §1.1):
 * GET /users/me com o token do lojista → refs externas não-sensíveis. */
export async function validateOnboardingConnection(
  http: OnboardingHttpClient,
  accessToken: string
): Promise<Record<string, unknown>> {
  let body: unknown
  try {
    ;({ body } = await http.request("GET", "/users/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    }))
  } catch (err) {
    const e = err as { status?: number }
    if (e.status === 401 || e.status === 403) {
      throw new OnboardingError(
        "invalid_credential",
        400,
        "credencial recusada pela adquirente"
      )
    }
    throw err
  }
  return toExternalRefs(body)
}

function toExternalRefs(body: unknown): Record<string, unknown> {
  const me = (body ?? {}) as { id?: unknown; nickname?: unknown }
  if (typeof me.id !== "string" && typeof me.id !== "number") {
    throw new OnboardingError("invalid_credential", 502, "/users/me sem id")
  }
  return {
    user_id: String(me.id),
    ...(typeof me.nickname === "string" ? { nickname: me.nickname } : {}),
  }
}
