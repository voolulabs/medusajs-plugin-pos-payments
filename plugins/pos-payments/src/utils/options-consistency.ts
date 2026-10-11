/**
 * A6 (W2.1): fonte única de credenciais. O provider lê as options do registro
 * do módulo payment; as rotas admin e o subscriber leem o bloco `posTerminal`
 * das options do plugin (ADR 0005). O medusa-config do host repassa as MESMAS
 * env vars para as duas entradas — mas nada impedia drift silencioso (token/
 * secret/testMode divergentes entre as duas entradas de cobrança). Aqui a
 * divergência falha alto na primeira resolução do provider, citando as chaves
 * e NUNCA os valores.
 *
 * ESCOPO (arquitetura-alvo, ADR 0002 §6): o host registra providers `manual`
 * (card/pix/cash/transfer) AO LADO do mercadopago, com o bloco `posTerminal`
 * configurado para a adquirente — um provider manual não lê o bloco, então a
 * comparação só existe quando a ENTRADA DO PROVIDER é não-manual (onde
 * credenciais e webhook estão em jogo).
 */
import { MedusaError } from "@medusajs/framework/utils"

/** Campos compartilhados pelas duas entradas — o objeto efetivo (com defaults). */
type EffectiveTerminalConfig = {
  acquirer: string
  accessToken: string | undefined
  webhookSecret: string | undefined
  mpPointTestMode: boolean
}

type RawOptions = {
  acquirer?: string
  accessToken?: string
  webhookSecret?: string
  mpPointTestMode?: boolean
} & Record<string, unknown>

export function effectiveTerminalConfig(
  options: RawOptions | undefined
): EffectiveTerminalConfig {
  return {
    // Default "manual" tem sentido só no LADO PLUGIN: bloco posTerminal ausente
    // com provider não-manual diverge em `acquirer` e falha alto. No lado do
    // provider a ausência NÃO é manual (ver assertOptionsConsistency).
    acquirer: options?.acquirer ?? "manual",
    accessToken: options?.accessToken,
    webhookSecret: options?.webhookSecret,
    mpPointTestMode: options?.mpPointTestMode === true,
  }
}

const CAMPOS: ReadonlyArray<keyof EffectiveTerminalConfig> = [
  "acquirer",
  "accessToken",
  "webhookSecret",
  "mpPointTestMode",
]

/**
 * Falha alto na PRIMEIRA RESOLUÇÃO do provider (o loader do módulo payment é
 * lazy — `asFunction`) quando as duas entradas divergem para um provider
 * não-manual. O erro cita apenas NOMES de chaves — valores de credencial
 * nunca entram em log.
 */
export function assertOptionsConsistency(
  providerOptions: RawOptions | undefined,
  pluginPosTerminal: RawOptions | undefined,
  providerId: string
): void {
  // Fail-closed: provider SEM acquirer declarado não é "manual" — a omissão
  // não pode isentar a comparação de credenciais (no fluxo real o
  // validateOptions do loader garante acquirer antes do construtor).
  if (!providerOptions?.acquirer) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `pos-payments: provider ${providerId} sem options.acquirer declarado — corrija o config do host.`
    )
  }
  const provider = effectiveTerminalConfig(providerOptions)
  // Entrada manual não consome o bloco posTerminal: nada a comparar (os
  // registros manual do host convivem com o bloco da adquirente).
  if (provider.acquirer === "manual") return
  const plugin = effectiveTerminalConfig(pluginPosTerminal)
  const divergentes = CAMPOS.filter(
    (campo) => provider[campo] !== plugin[campo]
  )
  if (divergentes.length > 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `pos-payments: options divergentes entre o provider do módulo payment (${providerId}) e o bloco posTerminal do plugin — chaves: ${divergentes.join(", ")}. As duas entradas no medusa-config têm que nascer da mesma fonte (mesmas env vars); valores omitidos de propósito: corrija o config do host.`
    )
  }
}
