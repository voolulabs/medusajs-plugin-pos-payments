import { model } from "@medusajs/framework/utils"

/** Catálogo §8 do onboarding.md — payload mínimo SEM segredos (LGPD art. 37). */
export const PosPaymentsAuditEvent = model.define("pos_payments_audit_event", {
  id: model.id().primaryKey(),
  event: model.text(),
  acquirer: model.text().nullable(),
  actorId: model.text().nullable(),
  payload: model.json().nullable(),
  createdAt: model.dateTime().nullable(),
})
