import { describe, expect, it } from "vitest"
import { MercadoPagoAdapter } from "../adapter"
import { MpContractError } from "../types"
import { jsonResponse } from "./helpers"

function makeAdapter() {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const path = String(url)
    if (path.endsWith("/refund"))
      return jsonResponse(orderBody("refunded"), 201)
    if (path.endsWith("/cancel")) return jsonResponse(orderBody("canceled"))
    if (/\/v1\/orders\/[A-Za-z0-9-]+$/.test(path))
      return jsonResponse(orderBody("processed"))
    return jsonResponse(orderBody("created"))
  }) as unknown as typeof fetch
  return {
    adapter: new MercadoPagoAdapter({
      accessToken: "test-token-fixture",
      fetchImpl,
    }),
    calls,
  }
}

function orderBody(status: string) {
  return {
    id: "ORD-77",
    status,
    type: "point",
    config: { point: { terminal_id: "NEWLAND_N950__S1" } },
    transactions: { payments: [{ id: "PAY-1", amount: "19.99" }] },
  }
}

describe("busca na colisão de idempotência", () => {
  it("ordem reutilizada SEM terminal na confirmação falha alto", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const semTerminal = {
      id: "ORD-77",
      status: "created",
      type: "point",
      external_reference: "pay_01H",
      transactions: { payments: [{ id: "PAY-1", amount: "19.99" }] },
    }
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      if (init?.method === "POST") {
        return jsonResponse({ error: "idempotency_key_already_used" }, 409)
      }
      if (String(url).includes("?"))
        return jsonResponse({ data: [semTerminal] })
      return jsonResponse(semTerminal)
    }) as unknown as typeof fetch
    const adapter = new MercadoPagoAdapter({
      accessToken: "test-token-fixture",
      fetchImpl,
    })
    await expect(
      adapter.createCharge(
        {
          amountMinor: 1999,
          externalReference: "pay_01H",
          terminalId: "NEWLAND_N950__S1",
        },
        "idem-fixture:pay-01H"
      )
    ).rejects.toThrow(/não trouxe o terminal/)
    expect(calls[0]!.init.headers).toMatchObject({
      "X-Idempotency-Key": "idem-fixture:pay-01H",
    })
    expect(calls[2]!.url).toContain("/v1/orders/ORD-77")
    expect(calls).toHaveLength(3)
  })

  it("resposta da busca fora do contrato lança MpContractError (não o 409)", async () => {
    for (const corpo of [JSON.stringify({ data: null }), "{}"]) {
      const calls: Array<{ url: string; init: RequestInit }> = []
      const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init: init ?? {} })
        if (init?.method === "POST") {
          return jsonResponse({ error: "idempotency_key_already_used" }, 409)
        }
        return jsonResponse(JSON.parse(corpo))
      }) as unknown as typeof fetch
      const adapter = new MercadoPagoAdapter({
        accessToken: "test-token-fixture",
        fetchImpl,
      })
      await expect(
        adapter.createCharge(
          {
            amountMinor: 1999,
            externalReference: "pay_01H",
            terminalId: "NEWLAND_N950__S1",
          },
          "idem-fixture:pay-01H"
        )
      ).rejects.toThrow(MpContractError)
      expect(calls).toHaveLength(2)
    }
  })
})

describe("refund resiliente (refund originado no terminal)", () => {
  it("POST refund falha mas a ordem já está refunded → sucesso idempotente", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      if (init?.method === "POST") {
        return jsonResponse({ error: "refund_not_possible" }, 412)
      }
      return jsonResponse(orderBody("refunded"))
    }) as unknown as typeof fetch
    const adapter = new MercadoPagoAdapter({
      accessToken: "test-token-fixture",
      fetchImpl,
    })
    const view = await adapter.refundCharge("ORD-77", "k-refund")
    expect(view.state).toBe("refunded")
    expect(
      calls.some((c) => c.init.method === "POST" && c.url.endsWith("/refund"))
    ).toBe(true)
  })

  it("POST refund falha e a ordem segue paga → relança o erro original", async () => {
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return jsonResponse({ error: "refund_not_possible" }, 412)
      }
      return jsonResponse(orderBody("processed"))
    }) as unknown as typeof fetch
    const adapter = new MercadoPagoAdapter({
      accessToken: "test-token-fixture",
      fetchImpl,
    })
    await expect(adapter.refundCharge("ORD-77", "k-refund")).rejects.toThrow()
  })
})

describe("MpAdapter na interface comum", () => {
  it("createCharge converte minor->decimal e envia a idempotency key", async () => {
    const { adapter, calls } = makeAdapter()
    const out = await adapter.createCharge(
      {
        amountMinor: 1999,
        externalReference: "pay_01H",
        terminalId: "NEWLAND_N950__S1",
        expirationTime: "PT30M",
        description: "venda balcão",
        paymentMethodDefaultType: "credit_card",
      },
      "idem-fixture:pay-01H"
    )
    expect(out.chargeId).toBe("ORD-77")
    expect(out.view.state).toBe("pending")
    const body = JSON.parse(String(calls[0]!.init.body))
    expect(body.transactions.payments[0].amount).toBe("19.99")
    expect(body.config.point.terminal_id).toBe("NEWLAND_N950__S1")
    expect(body.expiration_time).toBe("PT30M")
    expect(body.description).toBe("venda balcão")
    expect(body.config.payment_method.default_type).toBe("credit_card")
    expect(calls[0]!.init.headers).toMatchObject({
      "X-Idempotency-Key": "idem-fixture:pay-01H",
    })
  })

  it("getCharge mapea processed -> paid com a view do T2", async () => {
    const { adapter } = makeAdapter()
    const view = await adapter.getCharge("ORD-77")
    expect(view.state).toBe("paid")
    expect(view.rawStatus).toBe("processed")
    expect(view.paymentId).toBe("PAY-1")
  })
})

describe("MpAdapter: colisão de idempotência e ciclo", () => {
  it("colisão 409 reconsulta por referência e nunca recria a ordem", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const ordem = {
      id: "ORD-77",
      status: "created",
      type: "point",
      external_reference: "pay_01H",
      config: { point: { terminal_id: "NEWLAND_N950__S1" } },
      transactions: { payments: [{ id: "PAY-1", amount: "19.99" }] },
    }
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      if (init?.method === "POST") {
        return jsonResponse({ error: "idempotency_key_already_used" }, 409)
      }
      // Busca (com query) devolve a lista; ordem completa confirma o terminal.
      if (String(url).includes("?")) return jsonResponse({ data: [ordem] })
      return jsonResponse(ordem)
    }) as unknown as typeof fetch
    const adapter = new MercadoPagoAdapter({
      accessToken: "test-token-fixture",
      fetchImpl,
    })
    const out = await adapter.createCharge(
      {
        amountMinor: 1999,
        externalReference: "pay_01H",
        terminalId: "NEWLAND_N950__S1",
      },
      "idem-fixture:pay-01H"
    )
    expect(out.chargeId).toBe("ORD-77")
    const metodos = calls.map((c) => c.init.method ?? "GET")
    expect(metodos.filter((m) => m === "POST")).toHaveLength(1)
    expect(calls[0]!.init.headers).toMatchObject({
      "X-Idempotency-Key": "idem-fixture:pay-01H",
    })
    const criado = JSON.parse(String(calls[0]!.init.body))
    expect(criado.transactions.payments[0].amount).toBe("19.99")
    expect(criado.config.point.terminal_id).toBe("NEWLAND_N950__S1")
    expect(calls[1]!.url).toContain("external_reference=pay_01H")
    expect(calls[2]!.url).toContain("/v1/orders/ORD-77")
    expect(calls).toHaveLength(3)
  })

  it("cancel em awaiting_terminal manda o header incondicional do contrato", async () => {
    const { adapter, calls } = makeAdapter()
    await adapter.cancelCharge("ORD-77", "k-cancel")
    expect(calls[0]!.init.headers).toMatchObject({
      "x-allow-cancelable-status": "at_terminal",
    })
  })

  it("cancel/refund expõem os estados da adquirente com key própria", async () => {
    const { adapter, calls } = makeAdapter()
    const cancel = await adapter.cancelCharge("ORD-77", "k-cancel")
    const refund = await adapter.refundCharge("ORD-77", "k-refund")
    expect(cancel.state).toBe("canceled")
    expect(refund.state).toBe("refunded")
    expect(calls[0]!.init.headers).toMatchObject({
      "X-Idempotency-Key": "k-cancel",
    })
    expect(calls[1]!.init.headers).toMatchObject({
      "X-Idempotency-Key": "k-refund",
    })
  })
})

describe("reuso com divergência na recuperação", () => {
  it("replay 409 com valor divergente falha alto (mesma ref e terminal)", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const ordem = {
      id: "ORD-77",
      status: "at_terminal",
      type: "point",
      external_reference: "pay_01H",
      config: { point: { terminal_id: "NEWLAND_N950__S1" } },
      transactions: { payments: [{ id: "PAY-1", amount: "29.99" }] },
    }
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      if (init?.method === "POST") {
        return jsonResponse({ error: "idempotency_key_already_used" }, 409)
      }
      if (String(url).includes("?")) return jsonResponse({ data: [ordem] })
      return jsonResponse(ordem)
    }) as unknown as typeof fetch
    const adapter = new MercadoPagoAdapter({
      accessToken: "test-token-fixture",
      fetchImpl,
    })
    await expect(
      adapter.createCharge(
        {
          amountMinor: 1999,
          externalReference: "pay_01H",
          terminalId: "NEWLAND_N950__S1",
        },
        "idem-fixture:pay-01H"
      )
    ).rejects.toThrow(/amount 29.99 ≠ 19.99/)
    expect(calls).toHaveLength(3)
    expect(calls[0]!.init.method).toBe("POST")
    expect(calls[0]!.init.headers).toMatchObject({
      "X-Idempotency-Key": "idem-fixture:pay-01H",
    })
    expect(calls[1]!.url).toContain("external_reference=pay_01H")
    expect(calls[2]!.url).toContain("/v1/orders/ORD-77")
  })
})
