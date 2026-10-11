import { describe, expect, it } from "vitest"
import { MedusaError } from "@medusajs/framework/utils"
import {
  assertOptionsConsistency,
  effectiveTerminalConfig,
} from "../options-consistency"

const PROVIDER = {
  acquirer: "mercadopago",
  accessToken: "tok-A",
  webhookSecret: "sec-A",
  mpPointTestMode: false,
} as const

describe("effectiveTerminalConfig", () => {
  it("aplica os defaults (manual, teste off, credenciais ausentes)", () => {
    expect(effectiveTerminalConfig({})).toEqual({
      acquirer: "manual",
      accessToken: undefined,
      webhookSecret: undefined,
      mpPointTestMode: false,
    })
  })

  it("não vaza fetchImpl nem chaves desconhecidas", () => {
    const cfg = effectiveTerminalConfig({
      ...PROVIDER,
      fetchImpl: globalThis.fetch,
    } as never) as Record<string, unknown>
    expect(Object.keys(cfg).sort()).toEqual([
      "accessToken",
      "acquirer",
      "mpPointTestMode",
      "webhookSecret",
    ])
  })
})

describe("assertOptionsConsistency (A6 — fonte única de credenciais)", () => {
  it("configs idênticas (com defaults) passam", () => {
    expect(() =>
      assertOptionsConsistency(
        PROVIDER,
        {
          acquirer: "mercadopago",
          accessToken: "tok-A",
          webhookSecret: "sec-A",
        },
        "pos-terminal_mercadopago"
      )
    ).not.toThrow()
  })

  it.each([
    ["acquirer", { acquirer: "manual" }],
    ["accessToken", { accessToken: "tok-B" }],
    ["webhookSecret", { webhookSecret: "sec-B" }],
    ["mpPointTestMode", { mpPointTestMode: true }],
  ] as const)(
    "provider mercadopago vs bloco divergente em %s falha alto na resolução",
    (_field, delta) => {
      expect(() =>
        assertOptionsConsistency(PROVIDER, delta, "pos-terminal_mercadopago")
      ).toThrow(MedusaError)
    }
  )

  it("provider MANUAL com bloco posTerminal de outra adquirente NÃO falha (arquitetura-alvo: card/pix/cash manuais convivem com o mercadopago — ADR 0002 §6)", () => {
    expect(() =>
      assertOptionsConsistency(
        { acquirer: "manual" },
        { acquirer: "mercadopago", accessToken: "tok-A" },
        "pos-terminal_card"
      )
    ).not.toThrow()
  })

  it("a mensagem cita as chaves divergentes MAS NUNCA os valores (segredo não vaza em log)", () => {
    let message = ""
    try {
      assertOptionsConsistency(
        PROVIDER,
        { accessToken: "tok-B", webhookSecret: "sec-B" },
        "pos-terminal_mercadopago"
      )
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain("accessToken")
    expect(message).toContain("webhookSecret")
    expect(message).not.toContain("tok-A")
    expect(message).not.toContain("tok-B")
    expect(message).not.toContain("sec-A")
    expect(message).not.toContain("sec-B")
  })

  it("provider SEM acquirer declarado falha alto (omissão não isenta a comparação de credenciais)", () => {
    expect(() =>
      assertOptionsConsistency(
        { accessToken: "tok-A" } as never,
        { acquirer: "mercadopago", accessToken: "tok-A" },
        "pos-terminal_mercadopago"
      )
    ).toThrow(/sem options\.acquirer/)
  })

  it("modo manual dos dois lados sem credenciais é consistente", () => {
    expect(() =>
      assertOptionsConsistency(
        { acquirer: "manual" },
        { acquirer: "manual" },
        "pos-terminal_card"
      )
    ).not.toThrow()
  })
})
