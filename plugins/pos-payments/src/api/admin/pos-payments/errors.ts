/** Mapeamento adapter → MedusaError (tabela da spec; error-handler do core). */
import { MedusaError } from "@medusajs/framework/utils"
import {
  MpApiError,
  MpContractError,
} from "../../../adapters/mercadopago/types"

/**
 * 404 da adquirente → NOT_FOUND (404), mensagem genérica (o id já está no
 * path). Demais falhas do adapter → UNEXPECTED_STATE: no error-handler do
 * framework o tipo cai no 500 PRESERVANDO a mensagem — decisão registrada na
 * spec: superfície admin-only e mensagens do client só carregam
 * método/path/status (o core loga logger.error para >=500).
 */
export function toMedusaError(error: unknown): MedusaError {
  if (error instanceof MpApiError && error.status === 404) {
    return new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "pos-payments: cobrança não encontrada na adquirente"
    )
  }
  // Mensagem interpolada SOMENTE nos tipos que o adapter controla (método/
  // path/status do client; wording das nossas validações). Erro desconhecido
  // (rede, bug) vira mensagem genérica — nada do mundo externo ecoa cru.
  if (error instanceof MpContractError) {
    return new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `pos-payments: contrato da adquirente violado (${error.message.slice(0, 200)})`
    )
  }
  if (error instanceof MpApiError) {
    return new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `pos-payments: operação recusada pela adquirente (${error.message.slice(0, 200)})`
    )
  }
  return new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    "pos-payments: falha inesperada na operação com a adquirente"
  )
}
