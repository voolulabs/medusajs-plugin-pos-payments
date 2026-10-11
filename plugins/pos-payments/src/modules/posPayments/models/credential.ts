import { model } from "@medusajs/framework/utils"

/** Segredos da conexão (tokens OAuth, credencial colada) — SEMPRE cifrados no
 * envelope AES-256-GCM (engenharia.md §3.4); leitura só no helper do adapter.
 * FK textual para pos_payments_connection.id — sem binding ORM cross-entity. */
export const PosPaymentsCredential = model.define("pos_payments_credential", {
  id: model.id().primaryKey(),
  connectionId: model.text(),
  /** Envelope `posp.v1.<keyId>.<iv>.<tag>.<ct>` (base64url). */
  payload: model.text(),
  createdAt: model.dateTime().nullable(),
  updatedAt: model.dateTime().nullable(),
})
