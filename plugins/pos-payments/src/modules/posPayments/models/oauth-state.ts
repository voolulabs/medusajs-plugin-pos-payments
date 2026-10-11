import { model } from "@medusajs/framework/utils"

/** state OAuth gerado no servidor (CSPRNG), expiração ≤ 10 min, uso único
 * (onboarding.md §7). Vinculado ao admin iniciador. */
export const PosPaymentsOauthState = model.define("pos_payments_oauth_state", {
  id: model.id().primaryKey(),
  state: model.text().unique(),
  acquirer: model.text(),
  actorId: model.text().nullable(),
  expiresAt: model.dateTime(),
  usedAt: model.dateTime().nullable(),
  createdAt: model.dateTime().nullable(),
})
