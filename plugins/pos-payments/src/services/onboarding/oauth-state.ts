/** state OAuth: CSPRNG, expiração curta, uso único (onboarding.md §7). */
import { randomBytes } from "node:crypto"
import type { PosPaymentsModuleService } from "../../modules/posPayments/service"

const STATE_TTL_MS = 10 * 60 * 1000

function newOauthState(): string {
  return randomBytes(32).toString("hex")
}

export async function issueState(
  module: PosPaymentsModuleService,
  acquirer: string,
  actorId: string | null
): Promise<string> {
  const state = newOauthState()
  await module.createPosPaymentsOauthStates([
    {
      state,
      acquirer,
      actorId,
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
      createdAt: new Date(),
    } as never,
  ])
  return state
}

type ConsumeResult =
  | { ok: true; actorId: string | null }
  | { ok: false; reason: "not_found" | "expired" | "used" }

/**
 * Consome o state (marca usedAt na 1ª leitura válida; 2ª leitura rejeita).
 * O race residual entre duas callbacks simultâneas é neutralizado pelo próprio
 * MP: o `code` é de uso único no provedor — a 2ª troca falha lá (guia oficial
 * de marketplace; state single-use e code single-use em camadas distintas).
 */
export async function consumeState(
  module: PosPaymentsModuleService,
  state: string,
  acquirer: string
): Promise<ConsumeResult> {
  const [row] = (await module.listPosPaymentsOauthStates({
    state,
    acquirer,
  })) as Array<{
    id: string
    usedAt: Date | null
    expiresAt: Date
    actorId: string | null
  }>
  if (!row) return { ok: false, reason: "not_found" }
  if (row.usedAt) return { ok: false, reason: "used" }
  if (row.expiresAt.getTime() <= Date.now())
    return { ok: false, reason: "expired" }
  await module.updatePosPaymentsOauthStates([
    { id: row.id, usedAt: new Date() } as never,
  ])
  return { ok: true, actorId: row.actorId }
}
