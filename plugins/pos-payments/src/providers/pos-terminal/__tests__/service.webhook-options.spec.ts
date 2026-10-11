import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { MedusaError } from "@medusajs/framework/utils"
import { describe, expect, it, vi } from "vitest"
import PosTerminalProviderService from "../service"

const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() }

function service(options: Record<string, unknown>) {
  return new PosTerminalProviderService({ logger } as never, options as never)
}

/** Container awilix-like de teste: resolve o CONFIG_MODULE com o bloco dado. */
function cradle(posTerminal: Record<string, unknown> | undefined) {
  const configModule = {
    plugins: [
      {
        resolve: "@voolulabs/medusajs-plugin-pos-payments",
        options: { ...(posTerminal ? { posTerminal } : {}) },
      },
    ],
  }
  return {
    logger,
    resolve: (key: string) =>
      key === ContainerRegistrationKeys.CONFIG_MODULE
        ? configModule
        : undefined,
  }
}

describe("validateOptions — webhookSecret obrigatório para mercadopago (T5)", () => {
  it("aceita mercadopago com accessToken e webhookSecret", () => {
    expect(() =>
      service({
        acquirer: "mercadopago",
        accessToken: "tok",
        webhookSecret: "sec",
      })
    ).not.toThrow()
  })

  it("falha alto sem webhookSecret (o loader chama o estático no boot)", () => {
    expect(() =>
      PosTerminalProviderService.validateOptions({
        acquirer: "mercadopago",
        accessToken: "tok",
      })
    ).toThrow(/webhookSecret/)
  })

  it("manual continua sem exigir credenciais", () => {
    expect(() => service({ acquirer: "manual" })).not.toThrow()
  })
})

describe("getWebhookActionAndData delega ao fluxo T5", () => {
  it("manual → not_supported (sem adapter, sem tocar o payload)", async () => {
    const svc = service({ acquirer: "manual" })
    await expect(
      svc.getWebhookActionAndData({
        data: {},
        rawData: Buffer.from("x"),
        headers: {},
      })
    ).resolves.toEqual({ action: "not_supported" })
  })
})

describe("consistência de options na resolução do provider (A6/W2.1 — provider vs bloco posTerminal)", () => {
  const providerOptions = {
    acquirer: "mercadopago",
    accessToken: "tok-A",
    webhookSecret: "sec-A",
    fetchImpl: async () => new Response("{}", { status: 200 }),
  }

  it("bloco posTerminal divergente do provider falha alto na primeira resolução", () => {
    expect(
      () =>
        new PosTerminalProviderService(
          cradle({ acquirer: "mercadopago", accessToken: "tok-B" }) as never,
          providerOptions as never
        )
    ).toThrow(/divergentes.*accessToken/s)
  })

  it("bloco posTerminal AUSENTE com provider mercadopago falha alto (rotas admin e subscriber ficariam mortos — CONSTRAINTS 4)", () => {
    expect(
      () =>
        new PosTerminalProviderService(
          cradle(undefined) as never,
          providerOptions as never
        )
    ).toThrow(MedusaError)
  })

  it("bloco idêntico (mesma fonte de env) sobe", () => {
    expect(
      () =>
        new PosTerminalProviderService(
          cradle({
            acquirer: "mercadopago",
            accessToken: "tok-A",
            webhookSecret: "sec-A",
          }) as never,
          providerOptions as never
        )
    ).not.toThrow()
  })

  it("providers manual do host NÃO são auditados contra o bloco da adquirente (arquitetura-alvo ADR 0002 §6: card/pix/cash convivem com mercadopago)", () => {
    expect(
      () =>
        new PosTerminalProviderService(
          cradle({
            acquirer: "mercadopago",
            accessToken: "tok-A",
            webhookSecret: "sec-A",
          }) as never,
          { acquirer: "manual" } as never
        )
    ).not.toThrow()
  })

  it("sem CONFIG_MODULE resolvível: degrada com info e NÃO derruba a resolução (embeds exóticos)", () => {
    const sole = { warn: vi.fn(), info: vi.fn(), error: vi.fn() }
    expect(
      () =>
        new PosTerminalProviderService(
          { logger: sole } as never,
          providerOptions as never
        )
    ).not.toThrow()
    expect(sole.info).toHaveBeenCalledWith(
      expect.stringMatching(/CONFIG_MODULE/)
    )
    expect(sole.warn).not.toHaveBeenCalled()
  })

  it("mensagem de divergência nunca contém o valor da credencial", () => {
    const exec = () =>
      new PosTerminalProviderService(
        cradle({ acquirer: "mercadopago", accessToken: "tok-VAZA" }) as never,
        providerOptions as never
      )
    // Primeiro o contrato: DEVE lançar (falha aqui se não lançar).
    expect(exec).toThrow(MedusaError)
    // Depois, a higiene da mensagem capturada (fora do assert de lançar).
    try {
      exec()
    } catch (error) {
      expect((error as Error).message).not.toContain("tok-VAZA")
    }
  })
})
