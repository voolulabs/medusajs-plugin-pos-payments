import { describe, expect, it } from "vitest"
import { POST } from "../charges/route"
import { adapterForRequest, resetTestModeWarn } from "../adapter-scope"
import {
  ORDER_OK,
  VALID_BODY,
  headerOf,
  makeReq,
  makeRes,
} from "./routes.helpers"

describe("POST /admin/pos-payments/charges", () => {
  it("cria a cobrança com a chave determinística do externalReference", async () => {
    const { req, calls } = makeReq({ body: VALID_BODY })
    const res = makeRes()
    await POST(req, res)
    expect(calls[0]!.url).toContain("/v1/orders")
    expect(headerOf(calls[0]!.init, "X-Idempotency-Key")).toBe(
      "7b33a42c-61b1-58ef-ad0b-b21de6c07978"
    )
    expect(headerOf(calls[0]!.init, "Authorization")).toBe(
      "Bearer test-token-fixture"
    )
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ chargeId: "ORD-1", rawStatus: "created" })
    )
  })

  it("payload no contrato oficial: amount decimal e terminal no config", async () => {
    const { req, calls } = makeReq({ body: VALID_BODY })
    await POST(req, makeRes())
    const payload = JSON.parse(String(calls[0]!.init.body)) as {
      transactions: { payments: Array<{ amount: string }> }
      config: { point: { terminal_id: string } }
    }
    expect(payload.transactions.payments[0]!.amount).toBe("19.99")
    expect(payload.config.point.terminal_id).toBe(VALID_BODY.terminalId)
  })
})

describe("guard MP_POINT_TEST_MODE na rota (T6)", () => {
  it("terminal sandbox sem o guard falha alto sem chamar a adquirente", async () => {
    const { req, calls } = makeReq({
      body: { ...VALID_BODY, terminalId: "NEWLAND_N950__SBX0000001" },
    })
    await expect(POST(req, makeRes())).rejects.toThrow(/MP_POINT_TEST_MODE/)
    expect(calls).toHaveLength(0)
  })

  it("terminal sandbox com posTerminal.mpPointTestMode=true cria a cobrança", async () => {
    // A ordem devolvida tem que bater com o input no reuse-guard (terminal e
    // external_reference) — sandbox de verdade do outro lado do seam.
    const sandboxOrder = {
      ...ORDER_OK,
      id: "ORD-SBX",
      config: { point: { terminal_id: "NEWLAND_N950__SBX0000001" } },
    }
    resetTestModeWarn()
    const { req, calls, loggerWarn } = makeReq({
      plugin: { mpPointTestMode: true },
      queue: [{ status: 201, body: sandboxOrder }],
      body: { ...VALID_BODY, terminalId: "NEWLAND_N950__SBX0000001" },
    })
    const res = makeRes()
    await POST(req, res)
    expect(calls[0]!.url).toContain("/v1/orders")
    expect(headerOf(calls[0]!.init, "X-Idempotency-Key")).toBe(
      "7b33a42c-61b1-58ef-ad0b-b21de6c07978"
    )
    expect(headerOf(calls[0]!.init, "Authorization")).toBe(
      "Bearer test-token-fixture"
    )
    const payload = JSON.parse(String(calls[0]!.init.body)) as {
      transactions: { payments: Array<{ amount: string }> }
      config: { point: { terminal_id: string } }
    }
    expect(payload.transactions.payments[0]!.amount).toBe("19.99")
    expect(payload.config.point.terminal_id).toBe("NEWLAND_N950__SBX0000001")
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ chargeId: "ORD-SBX" })
    )
    // Nunca silencioso (T6/r1): teste ativo na entrada rotas grita no log.
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.stringContaining("MP_POINT_TEST_MODE")
    )
    resetTestModeWarn()
  })

  it("adapterForRequest: warn de teste é 1× por processo (não spamma por request)", async () => {
    resetTestModeWarn()
    const first = makeReq({ plugin: { mpPointTestMode: true } })
    adapterForRequest(first.req)
    const second = makeReq({ plugin: { mpPointTestMode: true } })
    adapterForRequest(second.req)
    expect(first.loggerWarn).toHaveBeenCalledTimes(1)
    expect(second.loggerWarn).not.toHaveBeenCalled()
    resetTestModeWarn()
  })
})
