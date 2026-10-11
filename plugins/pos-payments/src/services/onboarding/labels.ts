/** Rótulos pt-BR da UI (onboarding.md §4) — estado canônico é o da tabela;
 * aqui só a copy. Importado pela página do Admin e pelos testes. */
import type { ActionReason, ConnectionStatus } from "./connection-state"

export const CONNECTION_STATUS_LABELS: Record<ConnectionStatus, string> = {
  unconfigured: "não conectado",
  connecting: "conectando…",
  connected: "conectado",
  action_required: "ação necessária",
  degraded: "verificar conexão",
  disconnected: "desconectado",
}

export const ACTION_REASON_LABELS: Record<ActionReason, string> = {
  reauthorize: "reconectar",
  pairing: "parear terminal",
  no_terminal: "selecionar terminal",
  recipient_kyc: "recebedor pendente",
  activation: "ativação pendente",
}

/** Indicador derivado (não é estado): "expirando (renovando)" perto do expiry. */
export function connectionLabel(
  status: ConnectionStatus,
  opts: { actionReason?: string | null; expiringSoon?: boolean } = {}
): string {
  if (status === "connected" && opts.expiringSoon) {
    return `${CONNECTION_STATUS_LABELS.connected} (renovando)`
  }
  if (status === "action_required") {
    const reason = opts.actionReason as
      keyof typeof ACTION_REASON_LABELS | undefined
    const detail = reason ? ACTION_REASON_LABELS[reason] : undefined
    return detail
      ? `${CONNECTION_STATUS_LABELS.action_required}: ${detail}`
      : CONNECTION_STATUS_LABELS.action_required
  }
  return CONNECTION_STATUS_LABELS[status]
}
