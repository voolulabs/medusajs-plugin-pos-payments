/** Taxonomia normativa de retentabilidade do MP — máquina oficial Point/QR da Orders API. */
import type { RetryClass } from "../types"

export type { RetryClass } from "../types"

export interface TaxonomyEntry {
  readonly retryClass: RetryClass
  /** Copy pt-BR para o operador do caixa — fonte única da mensagem. */
  readonly copy: string
}

/** status_detail da TRANSAÇÃO (o rico vive lá, não na order) → classe + copy. */
export const RETRY_TAXONOMY: Readonly<Record<string, TaxonomyEntry>> = {
  insufficient_amount: {
    retryClass: "retry_with_change",
    copy: "Recusado: saldo/limite insuficiente. Ajustar valor ou forma de pagamento.",
  },
  amount_limit_exceeded: {
    retryClass: "retry_with_change",
    copy: "Recusado: limite excedido. Ajustar valor ou parcelamento.",
  },
  bad_filled_card_data: {
    retryClass: "retry_with_change",
    copy: "Dados do cartão inválidos. Refazer a leitura ou inserção.",
  },
  invalid_installments: {
    retryClass: "retry_with_change",
    copy: "Parcelamento inválido. Ajustar o número de parcelas.",
  },
  rejected_by_issuer: {
    retryClass: "not_retryable",
    copy: "Recusado pelo emissor. Tentar outro cartão ou forma de pagamento.",
  },
  card_disabled: {
    retryClass: "not_retryable",
    copy: "Cartão desabilitado. Tentar outro cartão ou forma de pagamento.",
  },
  max_attempts_exceeded: {
    retryClass: "not_retryable",
    copy: "Máximo de tentativas excedido. Tentar outra forma de pagamento.",
  },
  failed: {
    retryClass: "not_retryable",
    copy: "Recusa sem causa especificada. Tentar outra forma de pagamento ou verificar o terminal.",
  },
  high_risk: {
    retryClass: "not_retryable",
    copy: "Recusado por análise de risco. Não repita imediatamente com dados iguais ou semelhantes.",
  },
  processing_error: {
    retryClass: "retryable",
    copy: "Erro de processamento. Tente novamente; se persistir, chame o suporte.",
  },
  in_review: {
    retryClass: "escalate",
    copy: "Pagamento em revisão. Escalar para o suporte.",
  },
  required_call_for_authorize: {
    retryClass: "escalate",
    copy: "Autorização por telefone necessária. Escalar para o suporte.",
  },
}

/** Estados que só existem na máquina Point — recebê-los em ordem qr é violação de contrato. */
export const QR_FORBIDDEN_STATUSES: ReadonlySet<string> = new Set([
  "at_terminal",
  "action_required",
  "failed",
])

/** Origem do cancelamento (status_detail da transação; "canceled" = genérico sem origem). */
export const CANCEL_ORIGINS: ReadonlySet<string> = new Set([
  "canceled_by_api",
  "canceled_on_terminal",
  "canceled",
])

/** Degradação conservadora para status_detail fora da tabela — nunca lança, copy nunca vazia. */
export const UNKNOWN_DETAIL: TaxonomyEntry = {
  retryClass: "not_retryable",
  copy: "Recusa não especificada pelo adquirente. Tentar outra forma de pagamento.",
}
