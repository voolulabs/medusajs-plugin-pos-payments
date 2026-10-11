/** Contexto compartilhado das rotas de onboarding (ADR 0005): módulo do
 * container, config de plataforma, http e ator; mapeamento de erros tipados
 * sem vazar detalhe interno (onboarding.md §7/§8). */
import type {
  AuthenticatedMedusaRequest,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import type { PosPaymentsModuleService } from "../../../modules/posPayments/service"
import { getPluginOptions } from "../../../utils/plugin-options"
import { OnboardingHttpClient } from "../../../adapters/mercadopago/onboarding-client"
import {
  mpOnboardingConfig,
  type MpOnboardingConfig,
} from "../../../types/onboarding-options"
import { OnboardingError } from "../../../services/onboarding/errors"
import { findConnection } from "../../../services/onboarding/connections"
import { getValidAccessToken } from "../../../services/onboarding/refresh"
import { refreshOnboardingToken } from "../../../adapters/mercadopago/onboarding"

export interface OnboardingContext {
  module: PosPaymentsModuleService
  /** Preguiçosa: só rotas que falam com a MP precisam de config OAuth —
   * operações locais (purga, health, binding) funcionam sem ela (runbook §6). */
  cfg: MpOnboardingConfig | null
  http: OnboardingHttpClient
  actorId: string | null
}

/** Resolve a config de plataforma (fail-closed) — chamar nas rotas MP. */
export function resolveMpConfig(
  req: MedusaRequest,
  ctx: OnboardingContext
): MpOnboardingConfig {
  if (!ctx.cfg) {
    ctx.cfg = mpOnboardingConfig(process.env, getPluginOptions(req.scope))
  }
  return ctx.cfg
}

export function onboardingContext(req: MedusaRequest): OnboardingContext {
  const module = req.scope.resolve("posPayments") as PosPaymentsModuleService
  const options = getPluginOptions(req.scope)
  const cfg: MpOnboardingConfig | null = null
  const http = new OnboardingHttpClient({
    ...(options.onboarding?.mercadopago?.fetchImpl
      ? { fetchImpl: options.onboarding.mercadopago.fetchImpl as typeof fetch }
      : {}),
  })
  const actorId =
    (req as AuthenticatedMedusaRequest).auth_context?.actor_id ?? null
  return { module, cfg, http, actorId }
}

/** Token do LOJISTA + user_id (refs da conexão) — pré-requisito das rotas de
 * loja/POS; renovação lazy acontece aqui. */
export async function merchantCredentials(
  req: MedusaRequest,
  ctx: OnboardingContext,
  acquirer = "mercadopago"
): Promise<{ token: string; userId: string }> {
  resolveMpConfig(req, ctx)
  const conn = await findConnection(ctx.module, acquirer)
  if (!conn || conn.status !== "connected") {
    throw new OnboardingError("not_connected", 409, "conexão não ativa")
  }
  const refs = (conn.externalRefs ?? {}) as Record<string, unknown>
  if (typeof refs.user_id !== "string" || !refs.user_id) {
    throw new OnboardingError(
      "not_connected",
      409,
      "user_id ausente na conexão"
    )
  }
  const cfg = resolveMpConfig(req, ctx)
  const token = await getValidAccessToken({
    module: ctx.module,
    acquirer,
    refresh: (rt) => refreshOnboardingToken(ctx.http, cfg, rt),
  })
  return { token, userId: refs.user_id }
}

/** Resposta de erro do onboarding: status tipado, sem payload do mundo externo. */
export function sendOnboardingError(res: MedusaResponse, error: unknown): void {
  if (error instanceof OnboardingError) {
    res.status(error.status).json({ code: error.code, message: error.message })
    return
  }
  res.status(502).json({
    code: "acquirer_unavailable",
    message: "operação recusada pela adquirente ou indisponível",
  })
}
