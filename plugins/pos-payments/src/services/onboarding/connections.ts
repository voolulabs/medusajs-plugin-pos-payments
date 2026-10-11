/** Orquestrador do ciclo de vida da conexão (onboarding.md §4/§8):
 * validate-then-activate, test, desconexão com purga. Refresh: refresh.ts. */
import type { PosPaymentsModuleService } from "../../modules/posPayments/service"
import {
  isConnectionStatus,
  transition,
  type ActionReason,
  type ConnectionStatus,
} from "./connection-state"
import { recordAudit } from "./audit"
import {
  purgeCredential,
  upsertCredential,
  type OAuthSecret,
} from "./credentials"

export interface ConnectionRow {
  id: string
  acquirer: string
  status: string
  actionReason: string | null
  externalRefs: Record<string, unknown> | null
  expiresAt: Date | null
  lastValidatedAt?: Date | null
}

export async function findConnection(
  module: PosPaymentsModuleService,
  acquirer: string
): Promise<ConnectionRow | null> {
  const [row] = (await module.listPosPaymentsConnections({
    acquirer,
  })) as unknown as ConnectionRow[]
  return row ?? null
}

export async function setStatus(
  module: PosPaymentsModuleService,
  conn: ConnectionRow,
  to: ConnectionStatus,
  opts: { actorId?: string | null; reason?: ActionReason | null } = {}
): Promise<void> {
  const from = isConnectionStatus(conn.status) ? conn.status : "unconfigured"
  const next = from === to ? to : transition(from as ConnectionStatus, to)
  await module.updatePosPaymentsConnections([
    {
      id: conn.id,
      status: next,
      actionReason: opts.reason ?? null,
      updatedBy: opts.actorId ?? null,
      updatedAt: new Date(),
    } as never,
  ])
  if (to === "action_required") {
    await recordAudit(module, {
      event: "actionRequired",
      acquirer: conn.acquirer,
      actorId: opts.actorId ?? null,
      payload: { reason: opts.reason ?? null },
    })
  }
  conn.status = next
}

/** Estado final de uma conexão validada (puro — facilita o teste). */
function buildConnectionValues(
  existing: ConnectionRow | null,
  input: {
    externalRefs?: Record<string, unknown>
    expiresAt?: Date | null
    actorId: string | null
  },
  refs: Record<string, unknown>,
  status: string
): Record<string, unknown> {
  return {
    status,
    actionReason: null,
    externalRefs: {
      ...((existing?.externalRefs ?? {}) as Record<string, unknown>),
      ...(input.externalRefs ?? {}),
      ...refs,
    },
    expiresAt: input.expiresAt ?? null,
    lastValidatedAt: new Date(),
    updatedBy: input.actorId,
    updatedAt: new Date(),
  }
}

/** validate-then-activate (§1.1): a chamada real acontece ANTES de qualquer
 * gravação — falha de validação não persiste nada (AC6). Re-conexão:
 * connected→connected é idempotente; disconnected volta por unconfigured
 * ("novo fluxo", §4). */
export async function connectValidated(
  module: PosPaymentsModuleService,
  input: {
    acquirer: string
    secret: OAuthSecret
    actorId: string | null
    from: "unconfigured" | "connecting"
    validate: () => Promise<Record<string, unknown>>
    externalRefs?: Record<string, unknown>
    expiresAt?: Date | null
  }
): Promise<ConnectionRow> {
  const refs = await input.validate()
  const existing = await findConnection(module, input.acquirer)
  const from = (
    existing && isConnectionStatus(existing.status)
      ? existing.status
      : input.from
  ) as ConnectionStatus
  const fromNormalized: ConnectionStatus =
    from === "disconnected" ? "unconfigured" : from
  const status =
    fromNormalized === "connected"
      ? "connected"
      : transition(fromNormalized, "connected")
  const values = buildConnectionValues(existing, input, refs, status)
  let conn = existing
  if (conn) {
    await module.updatePosPaymentsConnections([
      { id: conn.id, ...values } as never,
    ])
  } else {
    try {
      const created = (await module.createPosPaymentsConnections([
        {
          acquirer: input.acquirer,
          createdBy: input.actorId,
          ...values,
        } as never,
      ])) as unknown as ConnectionRow[]
      conn = created[0]!
    } catch (err) {
      // Corrida entre processos (unique de acquirer): a conexão já existe —
      // re-ler e seguir como update (idempotente na prática).
      const existingNow = await findConnection(module, input.acquirer)
      if (!existingNow) throw err
      await module.updatePosPaymentsConnections([
        { id: existingNow.id, ...values } as never,
      ])
      conn = existingNow
    }
  }
  await upsertCredential(module, conn.id, input.secret)
  await recordAudit(module, {
    event: "connected",
    acquirer: input.acquirer,
    actorId: input.actorId,
    payload: { from: fromNormalized },
  })
  return conn
}

// CORRIDA DELETE x POST (CodeRabbit, Major): sem lock por adquirente, um POST
// concorrente pode regravar a credencial depois do purge do DELETE. Mitigacao
// completa exige o Locking Module (registro no HOST, nao no plugin) - fila do
// onboarding; hoje a superficie e admin-only com operador unico.
export async function disconnectConnection(
  module: PosPaymentsModuleService,
  acquirer: string,
  actorId: string | null
): Promise<void> {
  const conn = await findConnection(module, acquirer)
  if (!conn) return
  await purgeCredential(module, conn.id)
  const from = isConnectionStatus(conn.status)
    ? (conn.status as ConnectionStatus)
    : "unconfigured"
  await module.updatePosPaymentsConnections([
    {
      id: conn.id,
      status:
        from === "disconnected"
          ? "disconnected"
          : transition(from, "disconnected"),
      actionReason: null,
      updatedBy: actorId,
      updatedAt: new Date(),
    } as never,
  ])
  await recordAudit(module, { event: "disconnected", acquirer, actorId })
}
