/** Guarda de reuso de sessão: a ordem recuperada pela chave tem que BATER. */
import type { CreateChargeInput } from "../types"
import { MpContractError, type MpOrder } from "./types"
import { minorUnitsToDecimalString } from "./money"

type OrderWithConfig = MpOrder & {
  config?: { point?: { terminal_id?: string } }
}

/** Valor e terminal da ordem reutilizada divergentes = falha alto (nunca segue). */
export function assertReusedOrder(
  order: MpOrder,
  input: CreateChargeInput
): void {
  const returnedAmount = order.transactions?.payments?.[0]?.amount
  if (returnedAmount !== minorUnitsToDecimalString(input.amountMinor)) {
    throw new MpContractError(
      `ordem ${order.id} retornou amount ${String(returnedAmount)} ≠ ${minorUnitsToDecimalString(input.amountMinor)} (sessão reutilizada com valor diferente)`
    )
  }
  const config = (order as OrderWithConfig).config
  const returnedTerminal = config?.point?.terminal_id
  if (returnedTerminal === undefined) {
    throw new MpContractError(
      `ordem ${order.id} não trouxe o terminal (sessão reutilizada sem confirmação)`
    )
  }
  if (returnedTerminal !== input.terminalId) {
    throw new MpContractError(
      `ordem ${order.id} pertence ao terminal ${returnedTerminal} ≠ ${input.terminalId} (sessão reutilizada em terminal diferente)`
    )
  }
}
