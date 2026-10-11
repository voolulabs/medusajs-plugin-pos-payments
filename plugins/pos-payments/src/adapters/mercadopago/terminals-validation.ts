/** Validações de terminal (listagem e setup) — contrato oficial da API de terminais. */
import { MpContractError } from "./types"
import { assertTerminalId } from "./validation"

/** Ids de store/pos da API são numéricos (ex. 47792476); teto de dígitos é choice da casa. */
const NUMERIC_ID = /^\d{1,20}$/
const OPERATING_MODES = new Set(["PDV", "STANDALONE"])

function assertLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new MpContractError(`limit deve ser inteiro 1–50: recebido ${limit}`)
  }
}

function assertOffset(offset: number): void {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new MpContractError(`offset deve ser inteiro ≥ 0: recebido ${offset}`)
  }
}

function assertNumericId(field: string, value: string): void {
  if (!NUMERIC_ID.test(value)) {
    throw new MpContractError(
      `${field} deve ser id numérico: recebido "${value}"`
    )
  }
}

/** Consulta da listagem: limit 1–50 (teto oficial da API), offset ≥ 0, ids numéricos. */
export function assertTerminalsQuery(query: {
  limit?: number
  offset?: number
  storeId?: string
  posId?: string
}): void {
  if (query.limit !== undefined) assertLimit(query.limit)
  if (query.offset !== undefined) assertOffset(query.offset)
  if (query.storeId !== undefined) assertNumericId("store_id", query.storeId)
  if (query.posId !== undefined) assertNumericId("pos_id", query.posId)
}

/** Item do setup validado em runtime: id formal e modo conhecido (TS não cobre o valor). */
export function assertSetupItem(item: {
  id: string
  operatingMode: string
}): void {
  assertTerminalId(item.id)
  if (!OPERATING_MODES.has(item.operatingMode)) {
    throw new MpContractError(
      `operating_mode deve ser PDV ou STANDALONE: recebido "${item.operatingMode}"`
    )
  }
}
