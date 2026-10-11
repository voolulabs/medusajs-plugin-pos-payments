import { createHmac } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import {
  mpWebhookAction,
  parseEnvelope,
  type WebhookPayload,
} from "../service-webhook"
import type { PosPaymentsAdapter } from "../../../adapters/types"
import type { StructuredLogger } from "../mp-status"

const SECRET = "segredo-webhook-fixture"
// Logger parcial: o caminho do webhook só usa warn (padrão dos specs do provider).
const logger = {
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
} as unknown as StructuredLogger

function payload(overrides?: Partial<Record<string, unknown>>): WebhookPayload {
  const id = (overrides?.id as string) ?? "ORD1"
  const ts = "1700000000"
  const requestId = "rid-1"
  const v1 = createHmac("sha256", SECRET)
    // Fórmula oficial: o data.id entra no canonical em LOWERCASE (nota da doc
    // de notifications, 2026-10-05) — o id do envelope pode chegar maiúsculo.
    .update(`id:${id.toLowerCase()};request-id:${requestId};ts:${ts};`)
    .digest("hex")
  return {
    data: {},
    rawData: Buffer.from(
      JSON.stringify({
        type: "order",
        action: "order.processed",
        data: {
          id,
          ...(overrides?.externo
            ? { external_reference: overrides.externo }
            : {}),
        },
      })
    ),
    headers: { "x-request-id": requestId, "x-signature": `ts=${ts},v1=${v1}` },
  }
}

function adapterCom(
  state: string,
  externalReference?: string
): PosPaymentsAdapter {
  return {
    acquirer: "mercadopago",
    createCharge: vi.fn(),
    getCharge: vi.fn(async () => ({
      state: state as never,
      rawStatus: state,
      amountMinor: 1000,
      ...(externalReference ? { externalReference } : {}),
    })),
    cancelCharge: vi.fn(),
    refundCharge: vi.fn(),
    listTerminals: vi.fn(),
  }
}

describe("mpWebhookAction (T5)", () => {
  it("paid → captured com session_id vinda do RE-FETCH (não do payload)", async () => {
    const res = await mpWebhookAction(
      adapterCom("paid", "ps_sessao_1"),
      payload({ externo: "falso-no-payload" }),
      SECRET,
      logger
    )
    expect(res).toEqual({
      action: "captured",
      data: { session_id: "ps_sessao_1", amount: 1000 },
    })
  })

  it("refunded/canceled → not_supported com session_id; demais estados → pending", async () => {
    const refundada = await mpWebhookAction(
      adapterCom("refunded", "ps_1"),
      payload(),
      SECRET,
      logger
    )
    expect(refundada).toEqual({ action: "not_supported" })
    expect(
      (
        await mpWebhookAction(
          adapterCom("canceled", "ps_1"),
          payload(),
          SECRET,
          logger
        )
      ).action
    ).toBe("not_supported")
    for (const estado of [
      "created",
      "at_terminal",
      "failed",
      "expired",
      "action_required",
    ]) {
      expect(
        (
          await mpWebhookAction(
            adapterCom(estado, "ps_1"),
            payload(),
            SECRET,
            logger
          )
        ).action
      ).toBe("pending")
    }
  })

  it("paid sem external_reference ou amount → descarte (captured exige os dois)", async () => {
    expect(
      await mpWebhookAction(adapterCom("paid"), payload(), SECRET, logger)
    ).toEqual({ action: "failed" })
    const semAmount = adapterCom("paid", "ps_1")
    semAmount.getCharge = vi.fn(
      async () => ({ state: "paid", rawStatus: "processed" }) as never
    )
    expect(await mpWebhookAction(semAmount, payload(), SECRET, logger)).toEqual(
      { action: "failed" }
    )
  })
})

describe("mpWebhookAction (T5) — descartes", () => {
  it("assinatura inválida → descarte silencioso (failed sem session, warn D6)", async () => {
    const adapter = adapterCom("paid", "ps_1")
    const res = await mpWebhookAction(
      adapter,
      {
        ...payload(),
        headers: { "x-request-id": "rid-1", "x-signature": "ts=1,v1=deadbeef" },
      },
      SECRET,
      logger
    )
    expect(res).toEqual({ action: "failed" })
    expect(adapter.getCharge).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalled()
  })

  it("re-fetch falhando → failed sem lançar", async () => {
    const adapter = adapterCom("paid", "ps_1")
    adapter.getCharge = vi.fn(async () => {
      throw new Error("MP 5xx")
    })
    const res = await mpWebhookAction(adapter, payload(), SECRET, logger)
    expect(res).toEqual({ action: "failed" })
  })

  it("envelope sem data.id → warn com charge_id ausente, sem buscar", async () => {
    const adapter = adapterCom("paid", "ps_1")
    const res = await mpWebhookAction(
      adapter,
      {
        ...payload(),
        rawData: Buffer.from(JSON.stringify({ type: "order" })),
      },
      SECRET,
      logger
    )
    expect(res).toEqual({ action: "failed" })
    expect(adapter.getCharge).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      "mercadopago: webhook descartado (assinatura)",
      expect.objectContaining({ charge_id: "ausente" })
    )
  })
})

describe("parseEnvelope", () => {
  it("extrai data.id como string e sobrevive a corpo quebrado", () => {
    expect(
      parseEnvelope(Buffer.from('{"type":"order","data":{"id":123456}}'))
    ).toEqual({ id: "123456" })
    expect(parseEnvelope(Buffer.from("nao-sou-json"))).toEqual({})
    expect(parseEnvelope(Buffer.from('{"type":"order"}'))).toEqual({})
  })
})
