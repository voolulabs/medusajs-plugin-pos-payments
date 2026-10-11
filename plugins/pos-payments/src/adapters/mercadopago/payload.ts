/** Construção pura de payloads do contrato Orders API (sem fetch/logger). */
import type { CreateChargeInput } from "../types"
import { minorUnitsToDecimalString } from "./money"
import type { CreatePointOrderInput } from "./types"

export interface SetupTerminalItem {
  id: string
  operatingMode: "PDV" | "STANDALONE"
}

/** Domínio (interface comum) → payload oficial: conversão única na fronteira. */
export function toCreateOrderInput(
  input: CreateChargeInput
): CreatePointOrderInput {
  return {
    amount: minorUnitsToDecimalString(input.amountMinor),
    externalReference: input.externalReference,
    terminalId: input.terminalId,
    ...(input.expirationTime ? { expirationTime: input.expirationTime } : {}),
    ...(input.description ? { description: input.description } : {}),
    ...(input.paymentMethodDefaultType
      ? { paymentMethodDefaultType: input.paymentMethodDefaultType }
      : {}),
  }
}

export function buildCreateOrderBody(input: CreatePointOrderInput): unknown {
  const paymentMethod = input.paymentMethodDefaultType
    ? { payment_method: { default_type: input.paymentMethodDefaultType } }
    : {}
  return {
    type: "point",
    external_reference: input.externalReference,
    ...(input.expirationTime ? { expiration_time: input.expirationTime } : {}),
    transactions: { payments: [{ amount: input.amount }] },
    config: {
      point: {
        terminal_id: input.terminalId,
        ...(input.printOnTerminal
          ? { print_on_terminal: input.printOnTerminal }
          : {}),
      },
      ...paymentMethod,
    },
    ...(input.description ? { description: input.description } : {}),
  }
}

/** A API aceita UM terminal por request (doc de migração Payment Intents → Orders). */
export function buildSetupBody(item: SetupTerminalItem): unknown {
  return { terminals: [{ id: item.id, operating_mode: item.operatingMode }] }
}
