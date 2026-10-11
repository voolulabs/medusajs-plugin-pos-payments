import { createHmac } from "node:crypto"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { describe, expect, it, vi } from "vitest"
import posPaymentsWebhook, { createHandler } from "../pos-payments-webhook"
import { resolveAdapter } from "../../adapters"
import type { PosPaymentsAdapter } from "../../adapters/types"

const SECRET = "segredo-webhook-fixture"

function evento(provider: string, id: string) {
  const ts = "1700000000"
  const v1 = createHmac("sha256", SECRET)
    // Fórmula oficial: data.id no canonical em LOWERCASE (notifications MP,
    // 2026-10-05) — o id do envelope pode chegar maiúsculo.
    .update(`id:${id.toLowerCase()};request-id:rid-1;ts:${ts};`)
    .digest("hex")
  return {
    provider,
    payload: {
      data: {},
      rawData: Buffer.from(JSON.stringify({ type: "order", data: { id } })),
      headers: { "x-request-id": "rid-1", "x-signature": `ts=${ts},v1=${v1}` },
    },
  }
}

function adapterFake(charge: Record<string, unknown>): PosPaymentsAdapter {
  return {
    acquirer: "mercadopago",
    createCharge: vi.fn(),
    getCharge: vi.fn(async () => charge as never),
    cancelCharge: vi.fn(),
    refundCharge: vi.fn(),
    listTerminals: vi.fn(),
  } as unknown as PosPaymentsAdapter
}

function deps(overrides?: Record<string, unknown>) {
  return {
    getAdapter: vi.fn(() =>
      adapterFake({
        state: "refunded",
        rawStatus: "refunded",
        externalReference: "ps_1",
      })
    ),
    getSecret: vi.fn(() => SECRET),
    logger: { warn: vi.fn(), info: vi.fn() },
    findPaymentBySession: vi.fn(async () => ({
      id: "pay_1",
      captured_at: "2026-10-04T12:00:00Z",
      refunds: [],
    })),
    refundTotal: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe("subscriber pos-payments-webhook (T5)", () => {
  it("provider de outro registro é no-op (nunca toca a MP)", async () => {
    const d = deps()
    await createHandler(d)({
      event: { data: evento("pp_pos-terminal_card", "ORD1") },
    })
    expect(d.getAdapter).not.toHaveBeenCalled()
  })

  it("sem adapter (manual) → no-op", async () => {
    const d = deps({ getAdapter: vi.fn(() => undefined) })
    await createHandler(d)({
      event: { data: evento("pp_pos-terminal_mercadopago", "ORD1") },
    })
    expect(d.findPaymentBySession).not.toHaveBeenCalled()
  })

  it("refunded de terminal → refund total 1x na sessão ecoada", async () => {
    const d = deps()
    await createHandler(d)({
      event: { data: evento("pp_pos-terminal_mercadopago", "ORD1") },
    })
    expect(d.findPaymentBySession).toHaveBeenCalledWith("ps_1")
    expect(d.refundTotal).toHaveBeenCalledWith("pay_1")
  })

  it("id sem o prefixo pp_ também reconcilia (forma sans-pp do path param)", async () => {
    // O core 2.19 prefixa pp_ INCONDICIONALMENTE ao path param para RESOLVER o
    // provider, mas o evento carrega o path param como chega — URL sans-pp no
    // painel entrega a forma sem prefixo. Se a forma sair de
    // PROVIDER_EVENT_IDS, o handler retorna antes da reconciliação e este
    // teste falha.
    const d = deps()
    await createHandler(d)({
      event: { data: evento("pos-terminal_mercadopago", "ORD1") },
    })
    expect(d.findPaymentBySession).toHaveBeenCalledWith("ps_1")
    expect(d.refundTotal).toHaveBeenCalledWith("pay_1")
  })

  it("entrega repetida pula (guarda de refund existente) e loga o motivo", async () => {
    const d = deps({
      findPaymentBySession: vi.fn(async () => ({
        id: "pay_1",
        captured_at: "2026-10-04T12:00:00Z",
        refunds: [{ id: "re_1" }],
      })),
    })
    await createHandler(d)({
      event: { data: evento("pp_pos-terminal_mercadopago", "ORD1") },
    })
    expect(d.refundTotal).not.toHaveBeenCalled()
    expect(d.logger.warn).toHaveBeenCalledWith(
      "mercadopago: reconciliacao pulada",
      expect.objectContaining({ motivo: "ja reembolsado" })
    )
  })

  it("assinatura inválida → descarte com warn D6, sem buscar pagamento", async () => {
    const d = deps({ getSecret: vi.fn(() => "outro-secret") })
    await createHandler(d)({
      event: { data: evento("pp_pos-terminal_mercadopago", "ORD1") },
    })
    expect(d.findPaymentBySession).not.toHaveBeenCalled()
    expect(d.logger.warn).toHaveBeenCalledWith(
      "mercadopago: reconciliacao descartada (assinatura)",
      expect.objectContaining({ charge_id: "ORD1" })
    )
  })

  it("falha transitória no re-fetch → warn e RE-THROW (event bus re-tenta)", async () => {
    const adapter = adapterFake({
      state: "refunded",
      rawStatus: "refunded",
      externalReference: "ps_1",
    })
    adapter.getCharge = vi.fn(async () => {
      throw new Error("MP 5xx")
    })
    const d = deps({ getAdapter: vi.fn(() => adapter) })
    await expect(
      createHandler(d)({
        event: { data: evento("pp_pos-terminal_mercadopago", "ORD1") },
      })
    ).rejects.toThrow("MP 5xx")
    expect(d.logger.warn).toHaveBeenCalledWith(
      "mercadopago: reconciliacao falhou",
      expect.objectContaining({ charge_id: "ORD1" })
    )
  })
})

describe("subscriber — rawData do event bus", () => {
  it("Buffer serializado do event bus persistido é re-hidratado antes do parse", async () => {
    const d = deps()
    const ev = evento("pp_pos-terminal_mercadopago", "ORD1")
    const serializado = {
      type: "Buffer",
      data: Array.from(ev.payload.rawData as Buffer),
    }
    await createHandler(d)({
      event: {
        data: {
          ...ev,
          payload: { ...ev.payload, rawData: serializado },
        },
      },
    })
    expect(d.refundTotal).toHaveBeenCalledWith("pay_1")
  })

  it("rawData ilegível → descarte com warn, sem lançar", async () => {
    const d = deps()
    await createHandler(d)({
      event: {
        data: {
          provider: "pp_pos-terminal_mercadopago",
          payload: {
            data: {},
            rawData: {} as Buffer,
            headers: {},
          },
        },
      },
    })
    expect(d.findPaymentBySession).not.toHaveBeenCalled()
    expect(d.logger.warn).toHaveBeenCalledWith(
      "mercadopago: reconciliacao descartada (assinatura)",
      expect.objectContaining({ charge_id: "ausente" })
    )
  })
})

describe("subscriber — fiação do container (default export)", () => {
  const { workflowRun } = vi.hoisted(() => ({
    workflowRun: vi.fn(async () => undefined),
  }))

  vi.mock("@medusajs/medusa/core-flows", () => ({
    refundPaymentWorkflow: vi.fn(() => ({ run: workflowRun })),
  }))

  vi.mock("../../adapters", () => ({
    resolveAdapter: vi.fn(() => ({
      acquirer: "mercadopago",
      getCharge: vi.fn(async () => ({
        state: "refunded",
        rawStatus: "refunded",
        externalReference: "ps_1",
      })),
    })),
  }))

  function container(graph: ReturnType<typeof vi.fn>, secret?: string) {
    return {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.CONFIG_MODULE) {
          return {
            plugins: [
              {
                resolve: "@voolulabs/medusajs-plugin-pos-payments",
                options: {
                  posTerminal: {
                    acquirer: "mercadopago",
                    accessToken: "tok",
                    ...(secret !== undefined ? { webhookSecret: secret } : {}),
                  },
                },
              },
            ],
          }
        }
        if (key === ContainerRegistrationKeys.LOGGER) {
          return { warn: vi.fn(), info: vi.fn() }
        }
        return { graph }
      },
    }
  }

  it("busca o payment por payment_session_id e reembolsa via workflow do core", async () => {
    const graph = vi.fn(
      async (args: {
        filters?: Record<string, unknown>
        fields?: string[]
      }) => ({
        data:
          args.filters?.payment_session_id === "ps_1"
            ? [
                {
                  id: "pay_1",
                  captured_at: "2026-10-04T12:00:00Z",
                  refunds: [],
                },
              ]
            : [],
      })
    )
    await posPaymentsWebhook({
      event: {
        name: "payment.webhook_received",
        data: evento("pp_pos-terminal_mercadopago", "ORD1"),
      },
      container: container(graph, SECRET) as never,
      pluginOptions: {},
    })
    expect(graph).toHaveBeenCalledTimes(1)
    expect(graph.mock.calls[0]![0]!.filters).toEqual({
      payment_session_id: "ps_1",
    })
    expect(graph.mock.calls[0]![0]!.fields).toContain("captured_at")
    expect(workflowRun).toHaveBeenCalledWith({
      input: { payment_id: "pay_1" },
      transactionId: "pos-payments-reconcile:pay_1",
    })
  })

  it("sem secret nas options → descarte com warn, workflow nunca roda", async () => {
    workflowRun.mockClear()
    const graph = vi.fn(async () => ({ data: [] }))
    await posPaymentsWebhook({
      event: {
        name: "payment.webhook_received",
        data: evento("pp_pos-terminal_mercadopago", "ORD1"),
      },
      container: container(graph) as never,
      pluginOptions: {},
    })
    expect(graph).not.toHaveBeenCalled()
    expect(workflowRun).not.toHaveBeenCalled()
  })
})

describe("subscriber — options quebradas (adapter lazy)", () => {
  it("evento de outro provider nem resolve o adapter", async () => {
    vi.mocked(resolveAdapter).mockImplementation((): never => {
      throw new Error("sem credencial")
    })
    const graph = vi.fn(async () => ({ data: [] }))
    const container = {
      resolve: (key: string) =>
        key === ContainerRegistrationKeys.CONFIG_MODULE
          ? {
              plugins: [
                {
                  resolve: "@voolulabs/medusajs-plugin-pos-payments",
                  options: {
                    posTerminal: { acquirer: "mercadopago" },
                  },
                },
              ],
            }
          : { graph },
    }
    await expect(
      posPaymentsWebhook({
        event: {
          name: "payment.webhook_received",
          data: evento("pp_pos-terminal_card", "X1"),
        },
        container: container as never,
        pluginOptions: {},
      })
    ).resolves.toBeUndefined()
    expect(graph).not.toHaveBeenCalled()
  })
})

describe("subscriber — cancelado no terminal (A1.7)", () => {
  it("charge canceled → log info, nenhum refund, retorno normal", async () => {
    const d = deps({
      getAdapter: vi.fn(() =>
        adapterFake({
          state: "canceled",
          rawStatus: "canceled",
          reasonCode: "canceled_on_terminal",
        })
      ),
    })
    await createHandler(d)({
      event: { data: evento("pp_pos-terminal_mercadopago", "ORD1") },
    })
    expect(d.findPaymentBySession).not.toHaveBeenCalled()
    expect(d.refundTotal).not.toHaveBeenCalled()
    expect(d.logger.info).toHaveBeenCalledWith(
      "mercadopago: cobranca cancelada no terminal — nada a reconciliar",
      expect.objectContaining({ charge_id: "ORD1" })
    )
  })
})
