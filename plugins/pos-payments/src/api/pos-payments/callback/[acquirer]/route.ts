import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import {
  exchangeCode,
  validateOnboardingConnection,
} from "../../../../adapters/mercadopago/onboarding"
import { connectValidated } from "../../../../services/onboarding/connections"
import { consumeState } from "../../../../services/onboarding/oauth-state"
import { getPluginOptions } from "../../../../utils/plugin-options"
import { OnboardingHttpClient } from "../../../../adapters/mercadopago/onboarding-client"
import { mpOnboardingConfig } from "../../../../types/onboarding-options"

/** GET /pos-payments/callback/:acquirer — PÚBLICA (ADR 0005): redirect do
 * navegador. Protegida pelo state single-use (§7); valida ANTES da troca do
 * code; trata error do adquirente como result=error SEM detalhe interno;
 * 302 de volta ao Admin (/app/settings/pos-payments). */
/** Base do Admin do host (admin.path é config do deploy — mesma env usada
 * no medusa-config; default /app). */
function adminBase(): string {
  return process.env.POS_PAYMENTS_ADMIN_PATH || "/app"
}

function redirect(
  res: MedusaResponse,
  acquirer: string,
  result: "ok" | "error"
): void {
  res.redirect(
    302,
    `${adminBase()}/settings/pos-payments?connection=${encodeURIComponent(acquirer)}&result=${result}`
  )
}

interface CallbackQuery {
  state: string | undefined
  code: string | undefined
  error: string | undefined
}

function readQuery(req: MedusaRequest): CallbackQuery {
  const raw = (req.query ?? {}) as Record<string, unknown>
  const str = (k: string): string | undefined =>
    typeof raw[k] === "string" && raw[k] ? (raw[k] as string) : undefined
  return { state: str("state"), code: str("code"), error: str("error") }
}

async function consumeAndConnect(
  req: MedusaRequest,
  acquirer: string,
  query: CallbackQuery
): Promise<void> {
  const module = req.scope.resolve("posPayments") as never
  const consumed = await consumeState(module, query.state!, acquirer)
  if (!consumed.ok) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "oauth state inválido ou expirado"
    )
  }
  const cfg = mpOnboardingConfig(process.env, getPluginOptions(req.scope))
  const options = getPluginOptions(req.scope)
  const http = new OnboardingHttpClient({
    ...(options.onboarding?.mercadopago?.fetchImpl
      ? { fetchImpl: options.onboarding.mercadopago.fetchImpl as typeof fetch }
      : {}),
  })
  const secret = await exchangeCode(http, cfg, query.code!)
  const refs = await validateOnboardingConnection(http, secret.access_token)
  await connectValidated(module, {
    acquirer,
    secret,
    actorId: consumed.actorId,
    from: "connecting",
    validate: async () => refs,
    expiresAt: secret.expires_at ? new Date(secret.expires_at) : null,
  })
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const acquirer = req.params.acquirer ?? ""
  const query = readQuery(req)
  const invalido =
    acquirer !== "mercadopago" ||
    Boolean(query.error) ||
    !query.state ||
    !query.code
  if (invalido) return redirect(res, acquirer, "error")
  try {
    await consumeAndConnect(req, acquirer, query)
    redirect(res, acquirer, "ok")
  } catch {
    // Mesma resposta para qualquer falha (state/adquirente/rede): o operador vê
    // o estado real na página; nada do mundo externo ecoa no redirect (§7).
    redirect(res, acquirer, "error")
  }
}
