/** Mapeamento da página de terminais (schema T1) para o domínio agnóstico. */
import type { TerminalInfo, TerminalsPage } from "../types"

type RawTerminal = {
  id: string
  pos_id?: number | string | undefined
  store_id?: number | string | undefined
  external_pos_id?: string | undefined
  operating_mode: string
}

type RawPage = {
  data: { terminals: RawTerminal[] }
  paging: { total: number; offset: number; limit: number }
}

const asString = (value: number | string | undefined): string | undefined =>
  value === undefined ? undefined : String(value)

/** Puro — snake_case da adquirente → domínio; o schema T1 já validou a forma. */
export function toTerminalsPage(raw: RawPage): TerminalsPage {
  const terminals: TerminalInfo[] = raw.data.terminals.map((terminal) => ({
    id: terminal.id,
    operatingMode: terminal.operating_mode,
    ...(terminal.store_id !== undefined
      ? { storeId: asString(terminal.store_id) }
      : {}),
    ...(terminal.pos_id !== undefined
      ? { posId: asString(terminal.pos_id) }
      : {}),
    ...(terminal.external_pos_id !== undefined
      ? { externalPosId: terminal.external_pos_id }
      : {}),
  }))
  return { terminals, paging: raw.paging }
}
