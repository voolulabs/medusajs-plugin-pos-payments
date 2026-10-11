/** Persistência das credenciais por conexão — SEMPRE cifradas no envelope
 * (CONSTRAINTS 8; engenharia.md §3.4). A leitura devolve o objeto decifrado
 * apenas para o helper do adapter; nunca para resposta/log. */
import type { PosPaymentsModuleService } from "../../modules/posPayments/service"
import {
  decryptSecret,
  encryptSecret,
  keySetFromEnv,
  type MasterKeySet,
} from "../../utils/crypto-envelope"

/** Tokens do par OAuth (uma linha = substituição atômica do par). */
export interface OAuthSecret {
  access_token: string
  refresh_token?: string
  expires_at?: string
}

function masterKeys(): MasterKeySet {
  return keySetFromEnv(process.env)
}

export async function upsertCredential(
  module: PosPaymentsModuleService,
  connectionId: string,
  secret: OAuthSecret
): Promise<void> {
  const envelope = encryptSecret(JSON.stringify(secret), masterKeys())
  const [existing] = (await module.listPosPaymentsCredentials({
    connectionId,
  })) as Array<{ id: string }>
  if (existing) {
    await module.updatePosPaymentsCredentials([
      { id: existing.id, payload: envelope, updatedAt: new Date() } as never,
    ])
    return
  }
  await module.createPosPaymentsCredentials([
    { connectionId, payload: envelope, createdAt: new Date() } as never,
  ])
}

export async function readSecret(
  module: PosPaymentsModuleService,
  connectionId: string
): Promise<OAuthSecret | null> {
  const [row] = (await module.listPosPaymentsCredentials({
    connectionId,
  })) as Array<{ payload: string }>
  if (!row) return null
  return JSON.parse(decryptSecret(row.payload, masterKeys())) as OAuthSecret
}

/** Purga (DELETE da conexão): a linha some — audit retém o histórico (§8). */
export async function purgeCredential(
  module: PosPaymentsModuleService,
  connectionId: string
): Promise<void> {
  const [row] = (await module.listPosPaymentsCredentials({
    connectionId,
  })) as Array<{ id: string }>
  if (row) await module.deletePosPaymentsCredentials(row.id)
}
