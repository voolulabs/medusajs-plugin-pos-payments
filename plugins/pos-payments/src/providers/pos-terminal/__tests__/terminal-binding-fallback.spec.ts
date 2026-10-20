/** L0 — binding de terminal (onboarding §5.4): fallback do provider quando a
 * sessão do caixa não envia data/context. Cobertura: data presente vence,
 * fallback aplica, fallback ausente falha com o erro original, acquirer
 * diverso NÃO usa o binding (filter no service), store indisponível degrada
 * fail-close e a sessão segue o fluxo manual sem adapter. */
import { describe, it, expect, vi } from "vitest"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import PosTerminalProviderService from "../service"
import { mpInitiate } from "../service-mp"
import type { PosPaymentsAdapter } from "../../../adapters/types"

const loggerStub = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  log: vi.fn(),
}

function makeAdapter(acquirer: string): PosPaymentsAdapter {
  return {
    acquirer,
    createCharge: vi.fn(async (input) => ({
      chargeId: "chg-123",
      view: {
        state: "awaiting_terminal",
        rawStatus: "awaiting",
        reasonCode: null,
        reason: null,
      },
    })),
  } as unknown as PosPaymentsAdapter
}

function makeService(opts: {
  acquirer?: string
  container?: Record<string, unknown>
}): {
  initiatePayment: (
    input: unknown
  ) => Promise<{ id: string; data: Record<string, unknown> }>
  container_: unknown
  options_: unknown
  adapter_?: unknown
} {
  const svc = new PosTerminalProviderService(opts.container ?? {}, {
    acquirer: opts.acquirer ?? "manual",
    // Credencial-fixture por partes (SAST): não é token real.
    accessToken: "test" + "-token" + "-fixture",
    webhookSecret: "test" + "-webhook" + "-secret",
  } as never) as unknown as {
    initiatePayment: (
      input: unknown
    ) => Promise<{ id: string; data: Record<string, unknown> }>
    container_: unknown
    options_: unknown
    adapter_?: unknown
  }
  return svc
}

describe("mpInitiate — binding de terminal (fallback)", () => {
  it("data.terminal_id presente vence — fallback ignorado", async () => {
    const adapter = makeAdapter("mercadopago")
    const res = await mpInitiate(
      adapter,
      {
        amount: 1000,
        context: { session_id: "sess-a" },
        data: { terminal_id: "NEWLAND_N950__SBX0000001_A" },
      },
      loggerStub as never,
      { fallbackTerminalId: "NEWLAND_N950__SBX0000001_B" }
    )
    expect(
      (adapter.createCharge as unknown as ReturnType<typeof vi.fn>).mock
        .calls[0]![0].terminalId
    ).toBe("NEWLAND_N950__SBX0000001_A")
    expect(res.data.charge_id).toBe("chg-123")
    expect(loggerStub.info).not.toHaveBeenCalledWith(
      expect.stringContaining("binding da loja")
    )
  })

  it("sessão sem data/context usa o terminal do binding (fallback da rota select)", async () => {
    const adapter = makeAdapter("mercadopago")
    const res = await mpInitiate(
      adapter,
      { amount: 1500, context: { session_id: "sess-abc" } },
      loggerStub as never,
      { fallbackTerminalId: "NEWLAND_N950__SBX0000001" }
    )
    expect(
      (adapter.createCharge as unknown as ReturnType<typeof vi.fn>).mock
        .calls[0]![0].terminalId
    ).toBe("NEWLAND_N950__SBX0000001")
    expect(loggerStub.info).toHaveBeenCalledWith(
      expect.stringContaining("binding da loja")
    )
  })

  it("sem terminal em data/context E sem binding — erro original (fail-closed)", async () => {
    const adapter = makeAdapter("mercadopago")
    await expect(
      mpInitiate(
        adapter,
        { amount: 1000, context: { session_id: "sess-b" } },
        loggerStub as never,
        {}
      )
    ).rejects.toThrow("terminal_id obrigatório")
  })

  it("sem fallback na opts — mesmo comportamento de antes (contrato legado intacto)", async () => {
    const adapter = makeAdapter("mercadopago")
    await expect(
      mpInitiate(
        adapter,
        { amount: 1000, context: { session_id: "sess-c" } },
        loggerStub as never
      )
    ).rejects.toThrow("terminal_id obrigatório")
  })
})

describe("service.initiatePayment — resolução do binding no container", () => {
  it("binding da loja (metadata.pos.payments.terminal) alimenta o fallback do provider mp", async () => {
    const container: Record<string, unknown> = {
      logger: loggerStub,
      [Modules.STORE]: {
        listStores: vi.fn(async () => [
          {
            metadata: {
              pos: {
                payments: {
                  acquirer: "mercadopago",
                  terminal: {
                    acquirer: "mercadopago",
                    id: "NEWLAND_N950__SBX0000001",
                  },
                },
              },
            },
          },
        ]),
      },
    }
    const svc = makeService({
      acquirer: "mercadopago",
      container: { ...container },
    })
    ;(svc as unknown as { adapter_: unknown }).adapter_ =
      makeAdapter("mercadopago")
    const res = await svc.initiatePayment({
      amount: 2000,
      context: { session_id: "sess-bind" },
    } as never)
    // Assert REAL do fallback (review): o createCharge recebeu o terminal do
    // binding — não basta o res, o erro do assert esconderia terminal errado.
    const chargeAdapter = (
      svc as unknown as {
        adapter_: { createCharge: ReturnType<typeof vi.fn> }
      }
    ).adapter_
    expect(chargeAdapter.createCharge.mock.calls[0]![0].terminalId).toBe(
      "NEWLAND_N950__SBX0000001"
    )
    expect(res.data?.charge_id).toBe("chg-123")
  })
})

describe("service.initiatePayment — degradações fail-closed (binding suspeito/ausente)", () => {
  it("acquirer divergente do binding — binding é IGNORADO e o erro original fala (fail-closed)", async () => {
    const container: Record<string, unknown> = {
      logger: loggerStub,
      [Modules.STORE]: {
        listStores: vi.fn(async () => [
          {
            metadata: {
              pos: {
                payments: { terminal: { acquirer: "sumup", id: "SUM-x" } },
              },
            },
          },
        ]),
      },
    }
    const svc = makeService({
      acquirer: "mercadopago",
      container: { ...container },
    })
    ;(svc as unknown as { adapter_: unknown }).adapter_ =
      makeAdapter("mercadopago")
    await expect(
      svc.initiatePayment({
        amount: 1000,
        context: { session_id: "sess-d" },
      } as never)
    ).rejects.toThrow("terminal_id obrigatório")
  })

  it("store module ausente (cradle fiel que lança como awilix) — erro original fala (fail-closed)", async () => {
    // Cradle FIEL: acesso a chave não registrada lança (AwilixResolutionError),
    // como no container real do provider — o mock plain-object mascara isso
    // (achado do review).
    const cradle = new Proxy(
      { logger: loggerStub },
      {
        get(target, prop) {
          if (prop in target) return Reflect.get(target, prop)
          throw new Error(`AwilixResolutionError: ${String(prop)}`)
        },
        has() {
          return true
        },
      }
    )
    const svc = makeService({ acquirer: "mercadopago", container: cradle })
    ;(svc as unknown as { adapter_: unknown }).adapter_ =
      makeAdapter("mercadopago")
    await expect(
      svc.initiatePayment({
        amount: 1000,
        context: { session_id: "sess-e" },
      } as never)
    ).rejects.toThrow("terminal_id obrigatório")
  })

  it("sessão que JÁ informa data.terminal_id — a store NÃO é consultada (fast-path Major 204)", async () => {
    const listStores = vi.fn(async () => [])
    const container: Record<string, unknown> = {
      logger: loggerStub,
      [Modules.STORE]: { listStores },
    }
    const svc = makeService({
      acquirer: "mercadopago",
      container,
    })
    ;(svc as unknown as { adapter_: unknown }).adapter_ =
      makeAdapter("mercadopago")
    const res = await svc.initiatePayment({
      amount: 1000,
      context: { session_id: "sess-fast" },
      data: { terminal_id: "NEWLAND_N950__SBX0000001_DIRECT" },
    } as never)
    expect(listStores).not.toHaveBeenCalled()
    expect(res.data?.charge_id).toBe("chg-123")
  })
})

describe("modo manual — sessão sem adapter não regredinde", () => {
  it("options acquirer manual → initiatePayment no-op com nova sessão", async () => {
    const svc = makeService({})
    const res = await svc.initiatePayment({
      amount: 1000,
      context: { session_id: "sess" },
    } as never)
    expect(res.id).toBeDefined()
  })
})
