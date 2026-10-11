import { describe, expect, it, vi } from "vitest"
import type {
  ChargeStatusView,
  PosPaymentsAdapter,
} from "../../../adapters/types"
import type { Logger } from "@medusajs/framework/types"
import { POLL_WINDOW, mpPoll } from "../mp-status"
import { mpCancel, mpCapture } from "../service-mp-ops"
import { mpRefund } from "../service-mp-refund"
import PosTerminalProviderService from "../service"

// Logger parcial: o service só usa info/warn no caminho MP.
const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger

const fakeAdapter = (
  get: PosPaymentsAdapter["getCharge"]
): PosPaymentsAdapter => ({
  acquirer: "mercadopago",
  createCharge: vi.fn(async () => ({
    chargeId: "ORD-1",
    view: { state: "pending", rawStatus: "created" } as ChargeStatusView,
  })),
  getCharge: vi.fn(get),
  cancelCharge: vi.fn(
    async () =>
      ({ state: "canceled", rawStatus: "canceled" }) as ChargeStatusView
  ),
  listTerminals: vi.fn(async () => ({
    terminals: [],
    paging: { total: 0, offset: 0, limit: 50 },
  })),
  refundCharge: vi.fn(
    async () =>
      ({ state: "refunded", rawStatus: "refunded" }) as ChargeStatusView
  ),
})

describe("provider mercadopago (wiring T3)", () => {
  it("initiate persista charge_id/acquirer/state/data_version/amount_minor", async () => {
    const order = {
      id: "ORD-9",
      status: "created",
      type: "point",
      config: { point: { terminal_id: "NEWLAND_N950__S1" } },
      transactions: { payments: [{ id: "PAY-1", amount: "19.99" }] },
    }
    const fetchImpl = (async (url: string | URL) =>
      new Response(JSON.stringify(order), { status: 201 })) as typeof fetch
    const service = new PosTerminalProviderService(
      { logger },
      {
        acquirer: "mercadopago",
        accessToken: "test-token-fixture",
        webhookSecret: "test-webhook-secret",
        fetchImpl,
      }
    )
    const out = await service.initiatePayment({
      id: "pay_01H",
      // Forma REAL do core (L3 2026-10-05, dist 2.19 + DB): amount em MINOR
      // units verbatim — 1999 = R$19,99. O plugin NÃO converte.
      amount: 1999,
      currency_code: "brl",
      context: {},
      data: {
        terminal_id: "NEWLAND_N950__S1",
        state: "paid",
        observacao: "mesa 7",
      },
    } as never)
    expect(out.id).toBe("ORD-9")
    expect(out.data).toMatchObject({
      charge_id: "ORD-9",
      acquirer: "mercadopago",
      state: "pending",
      data_version: 1,
      amount_minor: 1999,
      idempotency_key: "e14900ed-589d-5f0a-8cbc-7f384766990f", // gitleaks:allow — golden uuidv5 de teste (python uuid.uuid5), nao e credencial
    })
    // replay do cliente não forja estado; dados próprios da sessão preservados
    expect(out.data?.state).toBe("pending")
    expect(out.data?.terminal_id).toBe("NEWLAND_N950__S1")
    expect(out.data?.observacao).toBe("mesa 7")
  })

  it("initiate sem terminal_id falha alta", async () => {
    const service = new PosTerminalProviderService(
      { logger },
      {
        acquirer: "mercadopago",
        accessToken: "test-token-fixture",
        webhookSecret: "test-webhook-secret",
      }
    )
    await expect(
      service.initiatePayment({
        id: "pay_01",
        amount: 10,
        context: {},
        data: {},
      } as never)
    ).rejects.toThrow(/terminal_id/)
  })
})

describe("poll do provider mercadopago (janelas 10s/40s)", () => {
  it("POLL_WINDOW é contrato do plugin", async () => {
    expect(POLL_WINDOW).toEqual({ typicalSeconds: 10, maxSeconds: 40 })
  })

  it("poll mapea os 8 estados sem lançar e sem timeout como falha", async () => {
    const estados = [
      ["created", "pending"],
      ["at_terminal", "pending_authorization"],
      ["action_required", "pending_authorization"],
      ["processed", "authorized"],
      ["failed", "error"],
      ["expired", "canceled"],
      ["canceled", "canceled"],
      ["refunded", "captured"],
    ] as const
    const chargeState: Record<string, string> = {
      created: "pending",
      at_terminal: "awaiting_terminal",
      action_required: "action_required",
      processed: "paid",
      failed: "failed",
      expired: "expired",
      canceled: "canceled",
      refunded: "refunded",
    }
    for (const [raw, esperado] of estados) {
      const out = await mpPoll(
        fakeAdapter(
          async () =>
            ({ state: chargeState[raw]!, rawStatus: raw }) as ChargeStatusView
        ),
        { charge_id: "ORD-1", state: "pending" },
        logger as never
      )
      expect(out.status).toBe(esperado)
    }
  })

  it("divergência não-terminal força reconvergência com warn (paid->canceled)", async () => {
    const spy = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const out = await mpPoll(
      fakeAdapter(
        async () =>
          ({ state: "canceled", rawStatus: "canceled" }) as ChargeStatusView
      ),
      { charge_id: "ORD-1", state: "paid" },
      spy as never
    )
    expect(out.data?.state).toBe("canceled")
    expect(out.status).toBe("canceled")
    expect(spy.warn).toHaveBeenCalled()
  })

  it("poll sem charge_id não chama a adquirente", async () => {
    const adapter = fakeAdapter(
      async () =>
        ({ state: "paid", rawStatus: "processed" }) as ChargeStatusView
    )
    const out = await mpPoll(adapter, { state: "pending" }, logger as never)
    expect(out.status).toBe("pending")
    expect(adapter.getCharge).not.toHaveBeenCalled()
  })

  it("erro do poll degrada pending (não desiste na janela de 40s)", async () => {
    const out = await mpPoll(
      fakeAdapter(async () => {
        throw new Error("boom")
      }),
      { charge_id: "ORD-1", state: "awaiting_terminal" },
      logger as never
    )
    expect(out.status).toBe("pending")
  })
})

describe("poll captured-first (A11/W2.6 — captured_at no data vence)", () => {
  it("captured_at no data vence: poll devolve captured sem reconsultar a adquirente", async () => {
    const adapter = fakeAdapter(
      async () =>
        ({ state: "paid", rawStatus: "processed" }) as ChargeStatusView
    )
    const out = await mpPoll(
      adapter,
      {
        charge_id: "ORD-1",
        state: "paid",
        captured_at: "2026-10-06T12:00:00Z",
      },
      logger as never
    )
    expect(out.status).toBe("captured")
    expect(adapter.getCharge).not.toHaveBeenCalled()
  })

  it("sem captured_at o comportamento não muda: paid segue authorized (poll consulta)", async () => {
    const out = await mpPoll(
      fakeAdapter(
        async () =>
          ({ state: "paid", rawStatus: "processed" }) as ChargeStatusView
      ),
      { charge_id: "ORD-1", state: "pending" },
      logger as never
    )
    expect(out.status).toBe("authorized")
  })
})

describe("reconvergência e resiliência do poll", () => {
  it("estado terminal local divergente é PRESERVADO (nunca volta a máquina)", async () => {
    const spy = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const out = await mpPoll(
      fakeAdapter(
        async () =>
          ({ state: "refunded", rawStatus: "refunded" }) as ChargeStatusView
      ),
      { charge_id: "ORD-1", state: "failed" },
      spy as never
    )
    expect(out.data?.state).toBe("failed")
    expect(out.status).toBe("error")
    expect(spy.warn).toHaveBeenCalled()
  })

  it("getPaymentStatus via service: erro degrada pending e nunca lança", async () => {
    const fetchImpl = (async () =>
      new Response("{}", { status: 500 })) as typeof fetch
    const service = new PosTerminalProviderService(
      { logger },
      {
        acquirer: "mercadopago",
        accessToken: "test-token-fixture",
        webhookSecret: "test-webhook-secret",
        fetchImpl,
      }
    )
    const out = await service.getPaymentStatus({
      data: { charge_id: "ORD-1", state: "paid" },
    } as never)
    expect(out.status).toBe("pending")
  })

  it("initiate sem id de sessão falha alto (idempotência determinística)", async () => {
    const fetchImpl = (async () =>
      new Response("{}", { status: 201 })) as typeof fetch
    const service = new PosTerminalProviderService(
      { logger },
      {
        acquirer: "mercadopago",
        accessToken: "test-token-fixture",
        webhookSecret: "test-webhook-secret",
        fetchImpl,
      }
    )
    await expect(
      service.initiatePayment({
        amount: 10,
        context: {},
        data: { terminal_id: "T1" },
      } as never)
    ).rejects.toThrow(/idempotência/)
  })

  it("poll sem state no blob assume pending antes da transição", async () => {
    const out = await mpPoll(
      fakeAdapter(
        async () =>
          ({ state: "paid", rawStatus: "processed" }) as ChargeStatusView
      ),
      { charge_id: "ORD-1" },
      logger as never
    )
    expect(out.status).toBe("authorized")
    expect(out.data?.state).toBe("paid")
  })
})

describe("captura e cancelamento via adapter", () => {
  it("capture é confirmação local: exige paid e é idempotente", async () => {
    const base = { charge_id: "ORD-1", state: "paid", amount_minor: 1999 }
    const ok = await mpCapture(
      fakeAdapter(
        async () =>
          ({ state: "paid", rawStatus: "processed" }) as ChargeStatusView
      ),
      { ...base },
      logger as never
    )
    expect(ok.data.captured_at).toBeTruthy()
    const repetida = await mpCapture(
      fakeAdapter(
        async () =>
          ({ state: "paid", rawStatus: "processed" }) as ChargeStatusView
      ),
      ok.data,
      logger as never
    )
    expect(repetida.data.captured_at).toBe(ok.data.captured_at)
  })

  it("capture sem pagamento creditado falha alto (UNEXPECTED_STATE)", async () => {
    await expect(
      mpCapture(
        fakeAdapter(
          async () =>
            ({
              state: "awaiting_terminal",
              rawStatus: "at_terminal",
            }) as ChargeStatusView
        ),
        { charge_id: "ORD-1", state: "awaiting_terminal" },
        logger as never
      )
    ).rejects.toThrow(/creditado/)
  })

  it("erro de transição local NÃO vira recusa da adquirente", async () => {
    await expect(
      mpCancel(
        fakeAdapter(
          async () =>
            ({ state: "canceled", rawStatus: "canceled" }) as ChargeStatusView
        ),
        { charge_id: "ORD-1", state: "failed" },
        logger as never
      )
    ).rejects.toThrow(/transição proibida/)
  })

  it("cancel via adapter grava a transição; capturada recusa", async () => {
    const ok = await mpCancel(
      fakeAdapter(
        async () =>
          ({ state: "canceled", rawStatus: "canceled" }) as ChargeStatusView
      ),
      { charge_id: "ORD-1", state: "awaiting_terminal" },
      logger as never
    )
    expect(ok.data.state).toBe("canceled")
    await expect(
      mpCancel(
        fakeAdapter(
          async () =>
            ({ state: "canceled", rawStatus: "canceled" }) as ChargeStatusView
        ),
        {
          charge_id: "ORD-1",
          state: "canceled",
          captured_at: "2026-10-03T00:00:00Z",
        },
        logger as never
      )
    ).rejects.toThrow(/refund/)
  })
})

describe("refund do provider mercadopago", () => {
  it("refund manual sem amount grava refunded_at sem last_refunded_amount", async () => {
    const service = new PosTerminalProviderService(
      { logger },
      { acquirer: "manual" }
    )
    const out = await service.refundPayment({
      data: { authorized_at: "x" },
    } as never)
    expect(out.data?.refunded_at).toBeTruthy()
    expect(out.data?.last_refunded_amount).toBeUndefined()
  })

  it("ciclo via service: capture/cancel/refund delegam ao adapter", async () => {
    const respostas = [
      new Response(
        JSON.stringify({ id: "ORD-9", status: "processed", type: "point" })
      ),
      new Response(
        JSON.stringify({ id: "ORD-9", status: "canceled", type: "point" })
      ),
      new Response(
        JSON.stringify({ id: "ORD-9", status: "refunded", type: "point" }),
        { status: 201 }
      ),
    ]
    const fetchImpl = (async () =>
      respostas.shift() ?? new Response("{}", { status: 500 })) as typeof fetch
    const service = new PosTerminalProviderService(
      { logger },
      {
        acquirer: "mercadopago",
        accessToken: "test-token-fixture",
        webhookSecret: "test-webhook-secret",
        fetchImpl,
      }
    )
    const cap = await service.capturePayment({
      id: "x",
      data: { charge_id: "ORD-9", state: "paid", amount_minor: 1999 },
    } as never)
    expect(cap.data?.captured_at).toBeTruthy()
    expect(cap.data?.state).toBe("paid")
    const can = await service.cancelPayment({
      id: "x",
      data: { charge_id: "ORD-9", state: "awaiting_terminal" },
    } as never)
    expect(can.data?.state).toBe("canceled")
    const ref = await service.refundPayment({
      id: "x",
      // Forma REAL do core: refund.raw_amount (BigNumberRawValue) em MINOR
      // units — dist 2.19/2.21 idênticos; DB real: {"value":"1999",
      // "precision":20} para R$19,99.
      amount: { value: "1999", precision: 20 },
      data: { charge_id: "ORD-9", state: "paid", amount_minor: 1999 },
    } as never)
    expect(ref.data?.state).toBe("refunded")
    expect(ref.data?.refunded_at).toBeTruthy()
  })

  it("getPaymentStatus sem data degrada pending (ramo do coalescing)", async () => {
    const service = new PosTerminalProviderService(
      { logger },
      { acquirer: "manual" }
    )
    const out = await service.getPaymentStatus({} as never)
    expect(out.status).toBe("pending")
  })

  it("getPaymentStatus manual com data hostil degrada pending (catch legado)", async () => {
    const service = new PosTerminalProviderService(
      { logger },
      { acquirer: "manual" }
    )
    const hostil = {
      get captured_at(): string {
        throw new Error("getter hostil")
      },
    }
    const out = await service.getPaymentStatus({ data: hostil } as never)
    expect(out.status).toBe("pending")
  })
})

describe("refund e validações de sessão do provider mercadopago", () => {
  it("amount negativo falha alto na validação pura", async () => {
    const fetchImpl = (async () =>
      new Response("{}", { status: 201 })) as typeof fetch
    const service = new PosTerminalProviderService(
      { logger },
      {
        acquirer: "mercadopago",
        accessToken: "test-token-fixture",
        webhookSecret: "test-webhook-secret",
        fetchImpl,
      }
    )
    await expect(
      service.initiatePayment({
        id: "pay_01H",
        amount: -1,
        currency_code: "brl",
        context: {},
        data: { terminal_id: "NEWLAND_N950__S1" },
      } as never)
    ).rejects.toThrow(/positivo/)
  })

  it("amount fora do domínio de minor units falha alto (10.005)", async () => {
    const fetchImpl = (async () =>
      new Response("{}", { status: 201 })) as typeof fetch
    const service = new PosTerminalProviderService(
      { logger },
      {
        acquirer: "mercadopago",
        accessToken: "test-token-fixture",
        webhookSecret: "test-webhook-secret",
        fetchImpl,
      }
    )
    const fetchSpy = vi.fn(fetchImpl)
    const service2 = new PosTerminalProviderService(
      { logger },
      {
        acquirer: "mercadopago",
        accessToken: "test-token-fixture",
        fetchImpl: fetchSpy as unknown as typeof fetch,
      }
    )
    await expect(
      service2.initiatePayment({
        id: "pay_01H",
        amount: 10.005,
        currency_code: "brl",
        context: {},
        data: { terminal_id: "NEWLAND_N950__S1" },
      } as never)
    ).rejects.toThrow(/minor units/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("amount como BigNumberRawValue do core é aceito (objeto com value)", async () => {
    const order = {
      id: "ORD-9",
      status: "created",
      type: "point",
      config: { point: { terminal_id: "NEWLAND_N950__S1" } },
      transactions: { payments: [{ id: "PAY-1", amount: "19.99" }] },
    }
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      return new Response(JSON.stringify(order), { status: 201 })
    }) as typeof fetch
    const service = new PosTerminalProviderService(
      { logger },
      {
        acquirer: "mercadopago",
        accessToken: "test-token-fixture",
        webhookSecret: "test-webhook-secret",
        fetchImpl,
      }
    )
    const out = await service.initiatePayment({
      id: "pay_01H",
      // Forma REAL do core (BigNumberRawValue, precision 20 do Medusa): value
      // em MINOR units verbatim — 1999 no blob e "19.99" na wire.
      amount: { value: "1999", precision: 20 },
      currency_code: "brl",
      context: {},
      data: { terminal_id: "NEWLAND_N950__S1" },
    } as never)
    expect(out.data?.amount_minor).toBe(1999)
    const body = JSON.parse(String(calls[0]!.init.body))
    expect(body.transactions.payments[0].amount).toBe("19.99")
    expect(calls[0]!.init.headers).toMatchObject({
      "X-Idempotency-Key": "e14900ed-589d-5f0a-8cbc-7f384766990f", // gitleaks:allow — golden uuidv5 de teste (python uuid.uuid5), nao e credencial
    })
  })
})

// Fixture e fábrica compartilhadas pelos dois describes do seed (o helper
// captura as chamadas de rede para assertar a derivação da idempotência).
const ordemCriada = {
  id: "ORD-SEED",
  status: "created",
  type: "point",
  config: { point: { terminal_id: "NEWLAND_N950__S1" } },
  transactions: { payments: [{ id: "PAY-1", amount: "19.99" }] },
}

function serviceCapturandoSeeds() {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return new Response(JSON.stringify(ordemCriada), { status: 201 })
  }) as typeof fetch
  const service = new PosTerminalProviderService(
    { logger },
    {
      acquirer: "mercadopago",
      accessToken: "test-token-fixture",
      webhookSecret: "test-webhook-secret",
      fetchImpl,
    }
  )
  return { service, calls }
}

describe("seed de sessão — ordem do union (formas do core)", () => {
  it("data.session_id é o seed PRIMÁRIO (forma real: o core 2.19 injeta session_id no data)", async () => {
    const { service, calls } = serviceCapturandoSeeds()
    await service.initiatePayment({
      id: "pay_wrapper",
      amount: 1999,
      currency_code: "brl",
      context: { idempotency_key: "payses_wrapper" },
      // O dist 2.19 monta data = { ...input.data, session_id } antes de chamar
      // o provider — o seed tem que ser o session_id injetado, não o
      // idempotency_key do context (mesma derivação do E2E real).
      data: { terminal_id: "NEWLAND_N950__S1", session_id: "payses_data" },
    } as never)
    expect(calls[0]!.init.headers).toMatchObject({
      "X-Idempotency-Key": "ee1d9676-8643-5363-a251-3e68ea6ef631", // gitleaks:allow — golden uuidv5 de teste (python uuid.uuid5), nao e credencial
    })
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      external_reference: "payses_data",
      transactions: { payments: [{ amount: "19.99" }] },
      config: { point: { terminal_id: "NEWLAND_N950__S1" } },
    })
  })

  it("context.session_id vence mesmo com data.session_id concorrente (precedência do union)", async () => {
    const { service, calls } = serviceCapturandoSeeds()
    const out = await service.initiatePayment({
      id: "pay_fallback",
      amount: 1999,
      currency_code: "brl",
      context: { session_id: "payses_ctx" },
      // Semente concorrente: uma implementação que priorizasse data.session_id
      // passaria no teste se a expectativa não fosse do context.
      data: {
        terminal_id: "NEWLAND_N950__S1",
        session_id: "payses_concorrente",
      },
    } as never)
    expect(out.data?.amount_minor).toBe(1999)
    expect(calls[0]!.init.headers).toMatchObject({
      "X-Idempotency-Key": "78a9d9d6-f74e-588a-8420-18d78c338fd8", // gitleaks:allow — golden uuidv5 de teste (python uuid.uuid5), nao e credencial
    })
    // Header e ordem têm que concordar: external_reference = seed do header.
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      external_reference: "payses_ctx",
      transactions: { payments: [{ amount: "19.99" }] },
    })
  })

  it("context.idempotency_key é a segunda alternativa do seed", async () => {
    const { service, calls } = serviceCapturandoSeeds()
    await service.initiatePayment({
      id: "pay_fallback",
      amount: 1999,
      currency_code: "brl",
      context: { idempotency_key: "payses_key" },
      data: { terminal_id: "NEWLAND_N950__S1" },
    } as never)
    expect(calls[0]!.init.headers).toMatchObject({
      "X-Idempotency-Key": "5bbd3f92-eb2b-50fd-ac5b-4437af6a7c0b", // gitleaks:allow — golden uuidv5 de teste (python uuid.uuid5), nao e credencial
    })
  })
})

describe("seed de sessão — fallbacks e defesas de tipo", () => {
  it("idempotency_key não-string no context é ignorada pelo seed (defesa de tipo)", async () => {
    const { service, calls } = serviceCapturandoSeeds()
    await service.initiatePayment({
      id: "payses_tipado",
      amount: 1999,
      currency_code: "brl",
      context: { idempotency_key: 12345 },
      data: { terminal_id: "NEWLAND_N950__S1" },
    } as never)
    expect(calls[0]!.init.headers).toMatchObject({
      "X-Idempotency-Key": "56df5914-dbc0-5d9b-a33d-93936570b932", // gitleaks:allow — golden uuidv5 de teste (python uuid.uuid5), nao e credencial
    })
  })

  it("sem nada no context/data, o id da sessão é o seed (última alternativa)", async () => {
    const { service, calls } = serviceCapturandoSeeds()
    await service.initiatePayment({
      id: "payses_fallback",
      amount: 1999,
      currency_code: "brl",
      context: {},
      data: { terminal_id: "NEWLAND_N950__S1" },
    } as never)
    expect(calls[0]!.init.headers).toMatchObject({
      "X-Idempotency-Key": "8b0899d6-e63a-595d-9b79-d40dc684a57e", // gitleaks:allow — golden uuidv5 de teste (python uuid.uuid5), nao e credencial
    })
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      external_reference: "payses_fallback",
    })
  })

  it("context inteiramente ausente: seed cai no id da sessão", async () => {
    const { service, calls } = serviceCapturandoSeeds()
    await service.initiatePayment({
      id: "payses_semctx",
      amount: 1999,
      currency_code: "brl",
      data: { terminal_id: "NEWLAND_N950__S1" },
    } as never)
    expect(calls[0]!.init.headers).toMatchObject({
      "X-Idempotency-Key": "a6e88f3e-6495-511c-9835-22655ef2f32e", // gitleaks:allow — golden uuidv5 de teste (python uuid.uuid5), nao e credencial
    })
  })

  it("sem data, o terminal vem do context e o blob nasce vazio de dados do cliente", async () => {
    const { service, calls } = serviceCapturandoSeeds()
    const out = await service.initiatePayment({
      id: "payses_nodata",
      amount: 1999,
      currency_code: "brl",
      context: { terminal_id: "NEWLAND_N950__S1" },
    } as never)
    expect(out.id).toBe("ORD-SEED")
    expect(out.data?.terminal_id).toBeUndefined()
    expect(calls[0]!.init.headers).toMatchObject({
      "X-Idempotency-Key": "16c109f4-0344-59a9-8244-878aef403894", // gitleaks:allow — golden uuidv5 de teste (python uuid.uuid5), nao e credencial
    })
  })
})

describe("validações de sessão do provider mercadopago", () => {
  it("seed fora do alfabeto da external_reference falha alto", async () => {
    const fetchImpl = (async () =>
      new Response("{}", { status: 201 })) as typeof fetch
    const service = new PosTerminalProviderService(
      { logger },
      {
        acquirer: "mercadopago",
        accessToken: "test-token-fixture",
        webhookSecret: "test-webhook-secret",
        fetchImpl,
      }
    )
    await expect(
      service.initiatePayment({
        id: "pay com espaço!",
        amount: 10,
        context: {},
        data: { terminal_id: "T1" },
      } as never)
    ).rejects.toThrow(/alfabeto/)
  })

  it("refund parcial é recusado ANTES da adquirente (Point só total)", async () => {
    await expect(
      mpRefund(
        fakeAdapter(
          async () =>
            ({ state: "paid", rawStatus: "processed" }) as ChargeStatusView
        ),
        { charge_id: "ORD-1", state: "paid", amount_minor: 1999 },
        // Minor units válidos, valor DIFERENTE do cobrado → recusa parcial.
        "10",
        logger as never
      )
    ).rejects.toThrow(/parcial/)
  })
})

describe("guard MP_POINT_TEST_MODE no provider (T6)", () => {
  const sandboxOrder = {
    id: "ORD-SBX",
    status: "created",
    type: "point",
    config: { point: { terminal_id: "NEWLAND_N950__SBX0000001" } },
    transactions: { payments: [{ id: "PAY-1", amount: "19.99" }] },
  }

  function serviceWith(mpPointTestMode?: boolean) {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      return new Response(JSON.stringify(sandboxOrder), { status: 201 })
    }) as unknown as typeof fetch
    const service = new PosTerminalProviderService(
      { logger },
      {
        acquirer: "mercadopago",
        accessToken: "test-token-fixture",
        webhookSecret: "test-webhook-secret",
        fetchImpl,
        ...(mpPointTestMode === undefined ? {} : { mpPointTestMode }),
      }
    )
    return { service, fetchImpl, calls }
  }

  const initiateSandbox = {
    id: "pay_01SBX",
    // Forma REAL do core (BigNumberRawValue, precision 20): 1999 minor no blob
    // e "19.99" na wire, determinístico — sem float nu.
    amount: { value: "1999", precision: 20 },
    currency_code: "brl",
    context: {},
    data: { terminal_id: "NEWLAND_N950__SBX0000001" },
  }

  it("initiate para terminal sandbox sem o guard falha alto e não chama a rede", async () => {
    const { service, fetchImpl } = serviceWith()
    await expect(
      service.initiatePayment(initiateSandbox as never)
    ).rejects.toThrow(/MP_POINT_TEST_MODE/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("initiate para sandbox com mpPointTestMode=true cria a cobrança", async () => {
    const { service, fetchImpl, calls } = serviceWith(true)
    const out = await service.initiatePayment(initiateSandbox as never)
    expect(out.id).toBe("ORD-SBX")
    expect(out.data).toMatchObject({
      charge_id: "ORD-SBX",
      acquirer: "mercadopago",
      amount_minor: 1999,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(calls[0]!.url).toContain("/v1/orders")
    expect(calls[0]!.init.headers).toMatchObject({
      "X-Idempotency-Key": "13bfafc2-736a-5916-a64c-1a5e28836a5d", // gitleaks:allow — golden uuidv5 de teste (python uuid.uuid5), nao e credencial
      Authorization: "Bearer test-token-fixture",
    })
    const payload = JSON.parse(String(calls[0]!.init.body)) as {
      transactions: { payments: Array<{ amount: string }> }
      config: { point: { terminal_id: string } }
    }
    expect(payload.transactions.payments[0]!.amount).toBe("19.99")
    expect(payload.config.point.terminal_id).toBe("NEWLAND_N950__SBX0000001")
  })
})
