import { beforeEach, describe, expect, it, vi } from "vitest"
import { MedusaError } from "@medusajs/framework/utils"
import type { ChargeStatusView } from "../../../../../../../adapters/types"
import { MpApiError } from "../../../../../../../adapters/mercadopago/types"
import { adapterForRequest } from "../../../../adapter-scope"
import { makeRes } from "../../../../__tests__/routes.helpers"
import { POST } from "../route"

vi.mock("../../../../adapter-scope", () => ({ adapterForRequest: vi.fn() }))

const CHARGE_ID = "ORD-1"

function view(partial: Partial<ChargeStatusView>): ChargeStatusView {
  return {
    state: "pending",
    rawStatus: "created",
    ...partial,
  } as ChargeStatusView
}

function mpError(status: number, body: unknown): MpApiError {
  return new MpApiError(
    `Mercado Pago POST /v1/orders/${CHARGE_ID}/cancel: HTTP ${status}`,
    status,
    body
  )
}

function adapterMock(overrides: {
  cancelCharge?: () => Promise<ChargeStatusView>
  getCharge?: () => Promise<ChargeStatusView>
}) {
  return {
    cancelCharge: vi.fn(overrides.cancelCharge ?? (async () => view({}))),
    getCharge: vi.fn(overrides.getCharge ?? (async () => view({}))),
  }
}

function req(): never {
  return { params: { id: CHARGE_ID } } as never
}

beforeEach(() => {
  vi.mocked(adapterForRequest).mockReset()
})

describe("200/202 por estado (E1–E8)", () => {
  it("AC1 — MP cancela created: 200 com view canceled e chave sem opts", async () => {
    const adapter = adapterMock({
      cancelCharge: async () =>
        view({
          state: "canceled",
          rawStatus: "canceled",
          reasonCode: "canceled_by_api",
        }),
    })
    vi.mocked(adapterForRequest).mockReturnValue(adapter as never)
    const res = makeRes()
    await POST(req(), res)
    // 2 args: a decisão do header saiu da rota (incondicional na camada MP).
    expect(adapter.cancelCharge).toHaveBeenCalledWith(
      CHARGE_ID,
      expect.any(String)
    )
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ chargeId: CHARGE_ID, state: "canceled" })
    )
  })

  it("AC2 — MP 202 assíncrono: 202 com cancelRequested no corpo", async () => {
    vi.mocked(adapterForRequest).mockReturnValue(
      adapterMock({
        cancelCharge: async () =>
          view({
            state: "awaiting_terminal",
            rawStatus: "at_terminal",
            cancelRequested: true,
          }),
      }) as never
    )
    const res = makeRes()
    await POST(req(), res)
    expect(res.status).toHaveBeenCalledWith(202)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        chargeId: CHARGE_ID,
        state: "awaiting_terminal",
        cancelRequested: true,
      })
    )
  })

  it("AC2b — awaiting_terminal SEM o eco de cancellation_requested: 202 igual (E9)", async () => {
    vi.mocked(adapterForRequest).mockReturnValue(
      adapterMock({
        cancelCharge: async () =>
          view({ state: "awaiting_terminal", rawStatus: "at_terminal" }),
      }) as never
    )
    const res = makeRes()
    await POST(req(), res)
    expect(res.status).toHaveBeenCalledWith(202)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ state: "awaiting_terminal" })
    )
  })
})

describe("409 semântico direto em res (MC4 — nunca 500)", () => {
  it("AC3 — cannot_cancel_order: 409 com {code, message, state}", async () => {
    vi.mocked(adapterForRequest).mockReturnValue(
      adapterMock({
        cancelCharge: async () => {
          // Shape REAL da Orders API (observado ao vivo no sandbox 2026-10-07):
          // o corpo vem ENVELOPADO em {errors: [{code, message}]}.
          throw mpError(409, {
            errors: [
              {
                code: "cannot_cancel_order",
                message: "order is not cancelable in its current state",
              },
            ],
          })
        },
        getCharge: async () =>
          view({ state: "action_required", rawStatus: "action_required" }),
      }) as never
    )
    const res = makeRes()
    await expect(POST(req(), res)).resolves.toBeUndefined()
    expect(res.status).toHaveBeenCalledWith(409)
    const body = vi.mocked(res.json).mock.calls[0]?.[0] as Record<
      string,
      unknown
    >
    // MUTAÇÃO (AC10): trocar o literal cannot_cancel_order na rota faz este
    // teste falhar — é o gate que prova o contrato público do corpo.
    // Igualdade ESTRITA: o corpo 409 é contrato público — campo extra ou
    // ausente (inclusive message) tem que falhar (coderabbit, PR 62).
    expect(body).toEqual({
      code: "cannot_cancel_order",
      message: expect.any(String),
      state: "action_required",
    })
  })

  it("AC4a — order_already_canceled + ordem canceled: 200 idempotente (re-fetch)", async () => {
    const adapter = adapterMock({
      cancelCharge: async () => {
        throw mpError(409, {
          errors: [{ code: "order_already_canceled" }],
        })
      },
      getCharge: async () =>
        view({
          state: "canceled",
          rawStatus: "canceled",
          reasonCode: "canceled",
        }),
    })
    vi.mocked(adapterForRequest).mockReturnValue(adapter as never)
    const res = makeRes()
    await POST(req(), res)
    expect(adapter.getCharge).toHaveBeenCalledWith(CHARGE_ID)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ chargeId: CHARGE_ID, state: "canceled" })
    )
  })

  it("AC4b — order_already_canceled + estado divergente: 409 com o estado real", async () => {
    vi.mocked(adapterForRequest).mockReturnValue(
      adapterMock({
        cancelCharge: async () => {
          throw mpError(409, {
            errors: [{ code: "order_already_canceled" }],
          })
        },
        getCharge: async () =>
          view({ state: "awaiting_terminal", rawStatus: "at_terminal" }),
      }) as never
    )
    const res = makeRes()
    await POST(req(), res)
    expect(res.status).toHaveBeenCalledWith(409)
    const body = vi.mocked(res.json).mock.calls[0]?.[0] as Record<
      string,
      unknown
    >
    expect(body).toEqual({
      code: "order_already_canceled",
      message: expect.any(String),
      state: "awaiting_terminal",
    })
  })
})

describe("409 — shapes do corpo MP e re-fetch falho", () => {
  it("AC4c — order_already_canceled + re-fetch indisponível: 409 com state desconhecido", async () => {
    vi.mocked(adapterForRequest).mockReturnValue(
      adapterMock({
        cancelCharge: async () => {
          throw mpError(409, {
            errors: [{ code: "order_already_canceled" }],
          })
        },
        getCharge: async () => {
          throw new Error("re-fetch indisponível")
        },
      }) as never
    )
    const res = makeRes()
    await POST(req(), res)
    // Falha no re-fetch NÃO bloqueia o 409 (rota.ts:53) — o estado vira o
    // placeholder "desconhecido" e o corpo segue contrato público.
    expect(res.status).toHaveBeenCalledWith(409)
    const body = vi.mocked(res.json).mock.calls[0]?.[0] as Record<
      string,
      unknown
    >
    expect(body).toEqual({
      code: "order_already_canceled",
      message: expect.any(String),
      state: "desconhecido",
    })
  })

  it("forma plana legada {error: code} também é reconhecida (defensivo)", async () => {
    vi.mocked(adapterForRequest).mockReturnValue(
      adapterMock({
        cancelCharge: async () => {
          throw mpError(409, { error: "cannot_cancel_order" })
        },
        getCharge: async () =>
          view({ state: "action_required", rawStatus: "action_required" }),
      }) as never
    )
    const res = makeRes()
    await POST(req(), res)
    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "cannot_cancel_order" })
    )
  })
})

describe("erros fora do contrato de cancelamento", () => {
  it("404 da adquirente segue pelo toMedusaError (NOT_FOUND lançado)", async () => {
    vi.mocked(adapterForRequest).mockReturnValue(
      adapterMock({
        cancelCharge: async () => {
          throw mpError(404, {})
        },
      }) as never
    )
    const res = makeRes()
    await expect(POST(req(), res)).rejects.toMatchObject({
      type: MedusaError.Types.NOT_FOUND,
    })
  })

  it("409 com code FORA do contrato segue pelo toMedusaError (lançado, sem 409)", async () => {
    vi.mocked(adapterForRequest).mockReturnValue(
      adapterMock({
        cancelCharge: async () => {
          throw mpError(409, {
            errors: [{ code: "internal_validation_error" }],
          })
        },
      }) as never
    )
    const res = makeRes()
    // respondRefusal devolve false → o erro sobe pelo toMedusaError; a rota
    // NÃO responde o 409 semântico do contrato.
    await expect(POST(req(), res)).rejects.toThrow()
    expect(res.status).not.toHaveBeenCalled()
  })

  it("errors[0].code não-string não vira código do contrato (fora do contrato)", async () => {
    vi.mocked(adapterForRequest).mockReturnValue(
      adapterMock({
        cancelCharge: async () => {
          throw mpError(409, { errors: [{ code: 42 }] })
        },
      }) as never
    )
    const res = makeRes()
    // O getter devolve undefined para code não-string (types.ts) — o 409 não
    // é do contrato e sobe pelo toMedusaError.
    await expect(POST(req(), res)).rejects.toThrow()
    expect(res.status).not.toHaveBeenCalled()
  })
})
