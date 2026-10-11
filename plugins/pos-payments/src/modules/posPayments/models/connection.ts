import { model } from "@medusajs/framework/utils"

/** Conexão de onboarding por adquirente — estado NÃO-sensível (onboarding.md §5.2).
 * Segredos moram em pos_payments_credential (envelope cifrado). */
export const PosPaymentsConnection = model.define("pos_payments_connection", {
  id: model.id().primaryKey(),
  /** "mercadopago" — único por backend (1 conexão por adquirente). */
  acquirer: model.text().unique(),
  /** Máquina de estados do onboarding.md §4. */
  status: model.text(),
  /** Discrimina action_required (reauthorize|pairing|no_terminal|...). */
  actionReason: model.text().nullable(),
  /** Refs externas não-sensíveis (MP user_id etc.) — nunca tokens. */
  externalRefs: model.json().nullable(),
  /** Expiração do access token (renovação lazy antes deste instante). */
  expiresAt: model.dateTime().nullable(),
  lastValidatedAt: model.dateTime().nullable(),
  /** Ator admin da criação/última atualização (audit §8). */
  createdBy: model.text().nullable(),
  updatedBy: model.text().nullable(),
  createdAt: model.dateTime().nullable(),
  updatedAt: model.dateTime().nullable(),
})
