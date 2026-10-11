/** A7 (W2.2): testes do runner puro + da fiação do job agendado de conciliação. */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { describe, expect, it, vi } from "vitest"
import type { PosPaymentsAdapter } from "../../adapters/types"
import {
  createReconcileRunner,
  toCapturedPayment,
  type CapturedPaymentRow,
} from "../../providers/pos-terminal/reconcile-runner"
import posPaymentsReconcileJob, {
  config as jobConfig,
} from "../pos-payments-reconcile"
import type { PaymentLike } from "../../providers/pos-terminal/webhook-reconcile"

const { runMock } = vi.hoisted(() => ({
  runMock: vi.fn().mockResolvedValue({}),
}))

vi.mock("@medusajs/medusa/core-flows", () => ({
  refundPaymentWorkflow: vi.fn(() => ({ run: runMock })),
}))

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

function fakeAdapter(
  getCharge: (chargeId: string) => Promise<{ state: string }>
): PosPaymentsAdapter {
  return {
    acquirer: "mercadopago",
    getCharge,
  } as unknown as PosPaymentsAdapter
}

const PAYMENT: PaymentLike = {
  id: "pay_1",
  captured_at: "2026-10-06T12:00:00Z",
  refunds: [],
}

function makeDeps(overrides?: {
  adapter?: PosPaymentsAdapter | undefined
  getCharge?: (chargeId: string) => Promise<{ state: string }>
  rows?: CapturedPaymentRow[]
  payment?: PaymentLike | undefined
  refundTotal?: (paymentId: string) => Promise<unknown>
}) {
  const refundTotal =
    overrides?.refundTotal ?? vi.fn().mockResolvedValue(undefined)
  const deps = {
    getAdapter: () =>
      overrides?.adapter ??
      fakeAdapter(
        overrides?.getCharge ?? (async () => ({ state: "refunded" }))
      ),
    listCapturedPayments:
      overrides?.rows !== undefined
        ? async () => overrides.rows!
        : async () => [{ id: "pay_1", sessionId: "sess_1", chargeId: "ORD-1" }],
    findPaymentByPaymentId: async () => overrides?.payment ?? PAYMENT,
    refundTotal,
    logger,
  }
  return { deps, refundTotal }
}

describe("createReconcileRunner (A7/W2.2 — refund de terminal perdido no event bus)", () => {
  it("sem adapter (manual) não consulta nada", async () => {
    const listCapturedPayments = vi.fn(async () => [
      { id: "pay_1", sessionId: "sess_1", chargeId: "ORD-1" },
    ])
    const run = createReconcileRunner({
      getAdapter: () => undefined,
      listCapturedPayments,
      findPaymentByPaymentId: async () => PAYMENT,
      refundTotal: vi.fn(),
      logger,
    })
    await run()
    expect(listCapturedPayments).not.toHaveBeenCalled()
  })

  it("charge refunded na adquirente + payment capturado sem refund → refundTotal dispara", async () => {
    const { deps, refundTotal } = makeDeps()
    const outcomes = await createReconcileRunner(deps)()
    expect(refundTotal).toHaveBeenCalledWith("pay_1")
    expect(outcomes).toEqual([
      { paymentId: "pay_1", chargeId: "ORD-1", action: "refunded" },
    ])
  })

  it("payment já reembolsado → skipped, sem segunda chamada de refund", async () => {
    const { deps, refundTotal } = makeDeps({
      payment: { ...PAYMENT, refunds: [{ id: "ref_1" }] },
    })
    const outcomes = await createReconcileRunner(deps)()
    expect(refundTotal).not.toHaveBeenCalled()
    expect(outcomes[0]).toMatchObject({ action: "skipped" })
  })

  it("payment não capturado → skipped (refund de terminal antes da captura não existe)", async () => {
    const { deps, refundTotal } = makeDeps({
      payment: { id: "pay_1", captured_at: null },
    })
    const outcomes = await createReconcileRunner(deps)()
    expect(refundTotal).not.toHaveBeenCalled()
    expect(outcomes[0]).toMatchObject({
      action: "skipped",
      motivo: "nao capturado",
    })
  })

  it("charge ainda paid na adquirente → noop (nada a reconciliar)", async () => {
    const { deps, refundTotal } = makeDeps({
      getCharge: async () => ({ state: "paid" }),
    })
    const outcomes = await createReconcileRunner(deps)()
    expect(refundTotal).not.toHaveBeenCalled()
    expect(outcomes[0]).toMatchObject({ action: "noop" })
  })
})

describe("createReconcileRunner — correlação de external_reference e resiliência", () => {
  it("external_reference DIVERGENTE na adquirente → skipped SEM refund (fail-closed)", async () => {
    const { deps, refundTotal } = makeDeps({
      getCharge: async () => ({
        state: "refunded",
        externalReference: "sess_OUTRA",
      }),
    })
    const outcomes = await createReconcileRunner(deps)()
    expect(refundTotal).not.toHaveBeenCalled()
    expect(outcomes[0]).toMatchObject({
      action: "skipped",
      motivo: "external_reference divergente",
    })
  })

  it("external_reference AUSENTE na adquirente → vínculo local alimenta e refund dispara", async () => {
    const { deps, refundTotal } = makeDeps({
      getCharge: async () => ({ state: "refunded" }),
    })
    const outcomes = await createReconcileRunner(deps)()
    expect(refundTotal).toHaveBeenCalledWith("pay_1")
    expect(outcomes).toEqual([
      { paymentId: "pay_1", chargeId: "ORD-1", action: "refunded" },
    ])
  })

  it("falha em UM payment não derruba a varredura (warn e segue)", async () => {
    const refundTotal = vi.fn().mockResolvedValue(undefined)
    let first = true
    const deps = {
      getAdapter: () =>
        fakeAdapter(async () => {
          if (first) {
            first = false
            throw new Error("boom MP")
          }
          return { state: "refunded" }
        }),
      listCapturedPayments: async () => [
        { id: "pay_1", sessionId: "sess_1", chargeId: "ORD-1" },
        { id: "pay_2", sessionId: "sess_2", chargeId: "ORD-2" },
      ],
      findPaymentByPaymentId: async () => PAYMENT,
      refundTotal,
      logger,
    }
    const outcomes = await createReconcileRunner(deps)()
    expect(refundTotal).toHaveBeenCalledTimes(1)
    expect(outcomes.find((o) => o.paymentId === "pay_2")).toMatchObject({
      action: "refunded",
    })
    expect(logger.warn).toHaveBeenCalled()
  })
})

describe("toCapturedPayment (recorte JSONB em memória — ADR 0002)", () => {
  it("só aceita payment capturado (`paid` via mpCapture) com charge_id string", () => {
    expect(
      toCapturedPayment({
        id: "p1",
        payment_session_id: "s1",
        data: { charge_id: "ORD-1", state: "paid" },
      })
    ).toEqual({ id: "p1", sessionId: "s1", chargeId: "ORD-1" })
    expect(
      toCapturedPayment({
        id: "p2",
        payment_session_id: "s2",
        data: { charge_id: "ORD-2", state: "refunded" },
      })
    ).toBeUndefined()
    expect(
      toCapturedPayment({ id: "p3", payment_session_id: "s3", data: {} })
    ).toBeUndefined()
    expect(
      toCapturedPayment({
        id: "p4",
        payment_session_id: "s4",
        data: { charge_id: 123, state: "paid" },
      })
    ).toBeUndefined()
  })
})

describe("fiação do job (default export + config)", () => {
  it("config expõe name e schedule (cron diário fora do pico)", () => {
    expect(jobConfig.name).toBe("pos-payments-reconcile")
    expect(jobConfig.schedule).toBe("0 4 * * *")
  })
})

describe("fiação do job — guardas de presença e falha alta", () => {
  it("sem posTerminal mercadopago o job termina silencioso (não resolve LOGGER/QUERY)", async () => {
    const container = {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.CONFIG_MODULE)
          return {
            plugins: [
              {
                resolve: "@voolulabs/medusajs-plugin-pos-payments",
                options: {},
              },
            ],
          }
        throw new Error(`não deveria resolver: ${key}`)
      },
    }
    await posPaymentsReconcileJob(container as never)
  })

  it("com mercadopago mas SEM logger no container: falha alto (não roda às cegas — CONSTRAINTS 4)", async () => {
    const container = {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.CONFIG_MODULE)
          return {
            plugins: [
              {
                resolve: "@voolulabs/medusajs-plugin-pos-payments",
                options: {
                  posTerminal: {
                    acquirer: "mercadopago",
                    accessToken: "tok-fixture",
                  },
                },
              },
            ],
          }
        if (key === ContainerRegistrationKeys.LOGGER) return undefined
        throw new Error(`inesperado: ${key}`)
      },
    }
    await expect(posPaymentsReconcileJob(container as never)).rejects.toThrow(
      /logger indisponível/
    )
  })
})

describe("fiação do job — wiring com mercadopago (workflow + fetch auditados)", () => {
  it("varre payments na janela, re-fetcha e reconcilia", async () => {
    runMock.mockClear()
    const fetchImpl = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            id: "ORD-1",
            status: "refunded",
            type: "point",
            external_reference: "sess_1",
          }),
          { status: 200 }
        )
    )
    const graph = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            id: "pay_1",
            payment_session_id: "sess_1",
            data: { charge_id: "ORD-1", state: "paid" },
            captured_at: "2026-10-06T12:00:00Z",
          },
        ],
      })
      .mockResolvedValueOnce({
        data: [{ id: "pay_1", captured_at: "2026-10-06T12:00:00Z" }],
      })
    const container = {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.CONFIG_MODULE)
          return {
            plugins: [
              {
                resolve: "@voolulabs/medusajs-plugin-pos-payments",
                options: {
                  posTerminal: {
                    acquirer: "mercadopago",
                    accessToken: "tok-fixture",
                    fetchImpl,
                  },
                },
              },
            ],
          }
        if (key === ContainerRegistrationKeys.LOGGER) return logger
        if (key === ContainerRegistrationKeys.QUERY) return { graph }
        throw new Error(`inesperado: ${key}`)
      },
    }
    await posPaymentsReconcileJob(container as never)
    const [primeiraGraph] = graph.mock.calls[0] as [
      {
        entity: string
        filters: Record<string, unknown>
        pagination?: Record<string, unknown>
      },
    ]
    expect(primeiraGraph.entity).toBe("payment")
    expect(primeiraGraph.filters.provider_id).toBe(
      "pp_pos-terminal_mercadopago"
    )
    expect(primeiraGraph.filters.captured_at).toHaveProperty("$gte")
    expect(primeiraGraph.pagination).toMatchObject({
      skip: 0,
      take: 200,
      order: { captured_at: "ASC", id: "ASC" },
    })
    // Re-fetch do charge na Orders API (endpoint, id, método e auth auditados).
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://api.mercadopago.com/v1/orders/ORD-1"
    )
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      headers: expect.objectContaining({
        Authorization: "Bearer tok-fixture",
      }),
    })
    // Mesmo workflow e MESMA transactionId do subscriber (ADR 0007).
    expect(runMock).toHaveBeenCalledWith({
      input: { payment_id: "pay_1" },
      transactionId: "pos-payments-reconcile:pay_1",
    })
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("concluída"),
      expect.objectContaining({ reembolsados: 1 })
    )
  })
})
