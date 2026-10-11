/** Schemas de resposta da Orders API — parse fail-closed (2xx fora do contrato rejeita). */
import { z } from "@medusajs/framework/zod"
import { MpContractError, type MpOrder } from "./types"

const mpOrderSchema = z.looseObject({
  id: z.string().min(1),
  status: z.enum([
    "created",
    "at_terminal",
    "processed",
    "canceled",
    "expired",
    "action_required",
    "failed",
    "refunded",
  ]),
  type: z.string().optional(),
  external_reference: z.string().optional(),
  description: z.string().optional(),
  transactions: z
    .looseObject({
      payments: z
        .array(
          z.looseObject({
            id: z.string(),
            amount: z.string(),
            status: z.string().optional(),
            status_detail: z.string().optional(),
          })
        )
        .optional(),
    })
    .optional(),
})

const mpTerminalsPageSchema = z.looseObject({
  data: z.looseObject({
    terminals: z.array(
      z.looseObject({
        id: z.string().min(1),
        pos_id: z.union([z.number(), z.string()]).optional(),
        store_id: z.union([z.number(), z.string()]).optional(),
        external_pos_id: z.string().optional(),
        operating_mode: z.string(),
      })
    ),
  }),
  paging: z.looseObject({
    total: z.number(),
    offset: z.number(),
    limit: z.number(),
  }),
})

const mpSetupResponseSchema = z.looseObject({
  terminals: z
    .array(z.looseObject({ id: z.string().min(1), operating_mode: z.string() }))
    .min(1),
})

function parse<T>(schema: z.ZodType<T>, payload: unknown, what: string): T {
  const result = schema.safeParse(payload)
  if (!result.success) {
    throw new MpContractError(
      `resposta ${what} fora do contrato: ${result.error.message}`
    )
  }
  return result.data
}

export function parseOrder(payload: unknown): MpOrder {
  // O schema v4 tipa opcionais como `| undefined`; sob exactOptionalPropertyTypes
  // o cast é o ponto único de conciliação com a interface de domínio (MpOrder).
  return parse(mpOrderSchema, payload, "da ordem") as MpOrder
}

export function parseTerminalsPage(payload: unknown) {
  return parse(mpTerminalsPageSchema, payload, "da listagem de terminais")
}

export function parseSetupResponse(payload: unknown) {
  return parse(mpSetupResponseSchema, payload, "do setup de terminal")
}
