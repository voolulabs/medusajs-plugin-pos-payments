/** Entradas do charge: conversão de dinheiro e terminal — funções puras fail-closed. */
import { MathBN, MedusaError } from "@medusajs/framework/utils"

/**
 * Amount do core em MINOR units verbatim — validador puro fail-closed, SEM
 * conversão (L3 2026-10-05: dist 2.19 passa o amount verbatim e o banco real
 * confirma `raw_amount {"value":"1000","precision":20}` para R$10,00). A ÚNICA
 * conversão de dinheiro do plugin é na fronteira MP
 * (minorUnitsToDecimalString); converter aqui inflava a cobrança 100×.
 * Aceita number ou BigNumberRawValue {value}; fração de centavo rejeitada
 * ANTES do toNumber (toNumber arredondaria calado).
 */
export function assertMinorAmount(amount: unknown): number {
  const value =
    typeof amount === "object" &&
    amount !== null &&
    "value" in (amount as object)
      ? (amount as { value: string | number }).value
      : (amount as string | number)
  const bn = MathBN.mult(String(value), 1)
  if (String(bn).includes(".")) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "mercadopago: valor monetário deve ser inteiro positivo em minor units"
    )
  }
  const minor = bn.toNumber()
  if (minor <= 0 || !Number.isSafeInteger(minor)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "mercadopago: valor monetário deve ser inteiro positivo em minor units"
    )
  }
  return minor
}

/** O terminal é obrigatório no data/context — sem ele não há cobrança. */
export function assertTerminalId(input: {
  data?: Record<string, unknown>
  context?: Record<string, unknown>
}): string {
  const terminalId =
    (input.data?.terminal_id as string | undefined) ??
    (input.context?.terminal_id as string | undefined)
  if (!terminalId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "mercadopago: terminal_id obrigatório no data/context para cobrar na maquininha"
    )
  }
  return terminalId
}
