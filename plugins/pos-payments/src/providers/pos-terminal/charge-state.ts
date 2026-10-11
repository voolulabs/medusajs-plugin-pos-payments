/** Máquina de transições do charge (CONSTRAINTS 2) + versionamento do blob (6). */
import type { ChargeState } from "../../adapters/types"

export const CHARGE_DATA_VERSION = 1

/**
 * Estados terminais: failed/expired/canceled/refunded. refunded pode partir
 * de qualquer estado não terminal (refund originado no terminal/reconciliação)
 * e de paid — origem capturada pelo poll/webhook do T5.
 */
export const ALLOWED_TRANSITIONS: Readonly<
  Record<ChargeState, readonly ChargeState[]>
> = {
  pending: [
    "awaiting_terminal",
    "action_required",
    "paid",
    "failed",
    "expired",
    "canceled",
    "refunded",
  ],
  awaiting_terminal: [
    "action_required",
    "paid",
    "failed",
    "expired",
    "canceled",
    "refunded",
  ],
  action_required: [
    "awaiting_terminal",
    "paid",
    "failed",
    "expired",
    "canceled",
    "refunded",
  ],
  paid: ["refunded"],
  failed: [],
  expired: [],
  canceled: [],
  refunded: [],
}

export class TransitionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TransitionError"
  }
}

/** Idempotente: from === to não é erro (poll repetido converge). */
export function transition(
  from: ChargeState,
  to: ChargeState
): { state: ChargeState; changed: boolean } {
  if (from === to) return { state: from, changed: false }
  if (ALLOWED_TRANSITIONS[from]?.includes(to))
    return { state: to, changed: true }
  throw new TransitionError(`transição proibida do charge: ${from} -> ${to}`)
}

/** Grava a transição no blob data com data_version (CONSTRAINTS 6). */
export function applyTransition(
  data: Record<string, unknown>,
  to: ChargeState
): Record<string, unknown> {
  const from = (data.state as ChargeState | undefined) ?? "pending"
  const result = transition(from, to)
  return { ...data, state: result.state, data_version: CHARGE_DATA_VERSION }
}
