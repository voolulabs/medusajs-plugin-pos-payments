/** Validações do contrato oficial Orders API do Mercado Pago (verificado 2026-09). */
import { MathBN } from "@medusajs/framework/utils"
import { MpContractError } from "./types"

const TWO_DECIMALS = /^\d+\.\d{2}$/
const EXTERNAL_REFERENCE = /^[A-Za-z0-9_-]{1,64}$/
const TERMINAL_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*__[A-Za-z0-9_-]+$/
const ISO_DURATION = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/
const MIN_EXPIRATION_S = 30
const MAX_EXPIRATION_S = 3 * 60 * 60

export function assertAmount(amount: string): void {
  if (!TWO_DECIMALS.test(amount) || MathBN.lte(amount, 0)) {
    throw new MpContractError(
      `amount deve ser string decimal positiva com 2 casas ("15.00"): recebido "${amount}"`
    )
  }
}

export function assertExternalReference(reference: string): void {
  if (!EXTERNAL_REFERENCE.test(reference)) {
    throw new MpContractError(
      "external_reference deve ter 1-64 caracteres de [A-Za-z0-9-_], sem PII" +
        `: recebido "${reference}"`
    )
  }
}

export function assertDescription(description: string): void {
  if (description.length > 150) {
    throw new MpContractError(
      `description deve ter no máximo 150 caracteres: recebido ${description.length}`
    )
  }
}

/** Forma oficial do identificador: {terminal_type}__{serial} (ex. NEWLAND_N950__SBX0000001). */
export function assertTerminalId(terminalId: string): void {
  if (!TERMINAL_ID.test(terminalId)) {
    throw new MpContractError(
      `terminal_id deve seguir "{tipo}__{serial}" (ex. NEWLAND_N950__SBX0000001): recebido "${terminalId}"`
    )
  }
}

/** Predicado puro da janela PT30S–PT3H — a rota usa para 400 na fronteira. */
export function isValidExpirationTime(duration: string): boolean {
  const match = ISO_DURATION.exec(duration)
  if (!match) return false
  const seconds =
    3600 * Number(match[1] ?? 0) +
    60 * Number(match[2] ?? 0) +
    Number(match[3] ?? 0)
  return seconds >= MIN_EXPIRATION_S && seconds <= MAX_EXPIRATION_S
}

/** Duração ISO-8601 na janela PT30S–PT3H (contrato do campo expiration_time). */
export function assertExpirationTime(duration: string): void {
  if (!ISO_DURATION.test(duration)) {
    throw new MpContractError(
      `expiration_time deve ser duração ISO-8601 (ex. PT15M): recebido "${duration}"`
    )
  }
  if (!isValidExpirationTime(duration)) {
    throw new MpContractError(
      `expiration_time fora da janela PT30S–PT3H: recebido "${duration}"`
    )
  }
}
