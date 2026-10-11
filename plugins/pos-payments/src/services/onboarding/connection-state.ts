import { MedusaError } from "@medusajs/framework/utils"

/** Máquina de estados da conexão (onboarding.md §4) — transição única, mesmo
 * padrão do charge (engenharia.md §1.2; CONSTRAINTS 2 aplicada ao ciclo de vida). */
export type ConnectionStatus =
  | "unconfigured"
  | "connecting"
  | "connected"
  | "action_required"
  | "degraded"
  | "disconnected"

export type ActionReason =
  "reauthorize" | "pairing" | "no_terminal" | "recipient_kyc" | "activation"

export const CONNECTION_TRANSITIONS: Record<
  ConnectionStatus,
  ConnectionStatus[]
> = {
  unconfigured: ["connecting", "connected"],
  connecting: ["connected", "unconfigured"],
  connected: ["action_required", "degraded", "disconnected"],
  action_required: ["connected", "disconnected"],
  degraded: ["connected", "action_required"],
  disconnected: ["unconfigured"],
}

export class IllegalTransitionError extends Error {
  constructor(
    public readonly from: ConnectionStatus,
    public readonly to: ConnectionStatus
  ) {
    super(`transição de conexão inválida: ${from} → ${to}`)
    this.name = "IllegalTransitionError"
  }
}

/** Mutador único: webhook/callback/poll/test convergem aqui. */
export function transition(
  from: ConnectionStatus,
  to: ConnectionStatus
): ConnectionStatus {
  if (!CONNECTION_TRANSITIONS[from]?.includes(to)) {
    throw new IllegalTransitionError(from, to)
  }
  return to
}

export function isConnectionStatus(v: unknown): v is ConnectionStatus {
  return (
    typeof v === "string" && Object.keys(CONNECTION_TRANSITIONS).includes(v)
  )
}

export function assertNeverStatus(v: never): never {
  throw new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    `estado de conexão não coberto: ${String(v)}`
  )
}
