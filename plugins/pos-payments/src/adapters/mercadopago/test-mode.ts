/** Guard MP_POINT_TEST_MODE — teste sem hardware só atrás de flag explícita. */
import { MpContractError } from "./types"

/** Prefixo de serial de sandbox (mercado-pago.md §8 — ex. NEWLAND_N950__SBX0000001). */
export const SANDBOX_SERIAL_PREFIX = "SBX"

/**
 * Predicado puro: o serial (após "__") começa com o prefixo de sandbox. Id sem
 * "__" não é sandbox — o FORMATO continua sob o assertTerminalId do cliente.
 */
export function isSandboxTerminal(terminalId: string): boolean {
  // lastIndexOf: um poi_type com "__" não pode esconder o serial do guard
  // (defesa em profundidade — o FORMATO continua sob o assertTerminalId).
  const sep = terminalId.lastIndexOf("__")
  if (sep === -1) return false
  // Case-insensitive: serial minúsculo não fura o guard.
  return terminalId
    .slice(sep + 2)
    .toUpperCase()
    .startsWith(SANDBOX_SERIAL_PREFIX)
}

/**
 * Fail-closed: sandbox sem o guard explícito não cria cobrança — a recusa
 * acontece ANTES de qualquer chamada de rede e cita o guard pelo nome
 * (nunca silencioso em produção; mercado-pago.md §8).
 */
export function assertTerminalAllowedByMode(
  terminalId: string,
  testMode: boolean
): void {
  if (testMode || !isSandboxTerminal(terminalId)) return
  throw new MpContractError(
    `pos-terminal: terminal de sandbox (${terminalId}) exige o guard MP_POINT_TEST_MODE=true — cobrança de teste nunca silenciosa em produção`
  )
}
