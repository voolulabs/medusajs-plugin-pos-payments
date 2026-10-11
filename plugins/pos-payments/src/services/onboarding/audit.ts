/** Catálogo de audit do onboarding (onboarding.md §8) — ator + adquirente +
 * timestamp; payload mínimo SEM segredos (LGPD art. 37). */
import type { PosPaymentsModuleService } from "../../modules/posPayments/service"

const AUDIT = {
  started: "connection.started",
  connected: "connection.connected",
  validationFailed: "connection.validation_failed",
  reauthorized: "connection.reauthorized",
  degraded: "connection.degraded",
  disconnected: "connection.disconnected",
  revoked: "connection.revoked",
  actionRequired: "connection.action_required",
  terminalSelected: "terminal.selected",
  credentialRotated: "credential.rotated",
  registerBound: "register.bound",
  registerUnbound: "register.unbound",
} as const

type AuditInput = {
  event: keyof typeof AUDIT
  acquirer?: string | null
  actorId?: string | null
  /** Valores já redigidos — nunca token/code/state/authorization. */
  payload?: Record<string, unknown>
}

export async function recordAudit(
  module: PosPaymentsModuleService,
  input: AuditInput
): Promise<void> {
  await module.createPosPaymentsAuditEvents([
    {
      event: AUDIT[input.event],
      acquirer: input.acquirer ?? null,
      actorId: input.actorId ?? null,
      payload: input.payload ?? null,
      createdAt: new Date(),
    } as never,
  ])
}
