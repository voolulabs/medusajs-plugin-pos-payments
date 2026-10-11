/** Zod da fronteira das rotas (§6.3) — fail-closed antes de falar com a MP. */
import { z } from "@medusajs/framework/zod"
import { MedusaError } from "@medusajs/framework/utils"
import { isValidExpirationTime } from "../../../adapters/mercadopago/validation"

const EXTERNAL_REFERENCE = /^[A-Za-z0-9-_]{1,64}$/
// Mesmo teto da validação do adapter (assertDescription) — 400 na fronteira.
const DESCRIPTION_MAX = 150

export const createChargeSchema = z.object({
  /** Minor units, inteiro > 0 — CONSTRAINTS 1 (a conversão é nossa). */
  amountMinor: z.number().int().positive(),
  externalReference: z.string().regex(EXTERNAL_REFERENCE),
  terminalId: z.string().min(1),
  description: z.string().max(DESCRIPTION_MAX).optional(),
  expirationTime: z
    .string()
    .refine(isValidExpirationTime, {
      message: "expirationTime deve ser duração ISO-8601 entre PT30S e PT3H",
    })
    .optional(),
  paymentMethodDefaultType: z
    .enum(["debit_card", "credit_card", "qr"])
    .optional(),
})

export const terminalsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  storeId: z
    .string()
    .regex(/^\d{1,20}$/)
    .optional(),
  posId: z
    .string()
    .regex(/^\d{1,20}$/)
    .optional(),
})

/** Parse fail-closed da fronteira: 400 com as mensagens das issues. */
export function parseOrThrow<T>(schema: z.ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload)
  if (!result.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      result.error.issues.map((issue) => issue.message).join("; ")
    )
  }
  return result.data
}

/** O path garante o :id — o guard tipa (params é opcional na assinatura). */
export function assertChargeId(id: string | undefined): string {
  if (!id) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "pos-payments: id do charge ausente no path"
    )
  }
  return id
}
