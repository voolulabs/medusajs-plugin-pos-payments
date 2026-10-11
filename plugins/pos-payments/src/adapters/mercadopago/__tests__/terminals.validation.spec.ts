import { describe, expect, it } from "vitest"
import { makeClient, SETUP_RESPONSE, TERMINALS_PAGE } from "./helpers"
import { listTerminals, setupTerminal } from "../terminals"
import { MpContractError } from "../types"

describe("listTerminals — validação de filtros antes da consulta", () => {
  it.each([
    ["limit 0", { limit: 0 }],
    ["limit acima do teto da API (51)", { limit: 51 }],
    ["offset negativo", { offset: -1 }],
    ["posId não numérico", { posId: "P1" }],
    ["storeId não numérico", { storeId: "S1" }],
  ])("rejeita %s com MpContractError", async (_nome, query) => {
    const { client, calls } = makeClient()
    await expect(listTerminals(client, query)).rejects.toBeInstanceOf(
      MpContractError
    )
    expect(calls).toHaveLength(0)
  })

  it("filtros válidos passam e a consulta acontece", async () => {
    const { client, calls } = makeClient([TERMINALS_PAGE])
    const page = await listTerminals(client, {
      limit: 10,
      offset: 5,
      storeId: "47792478",
      posId: "47792476",
    })
    expect(calls).toHaveLength(1)
    expect(page.paging.total).toBe(1)
  })
})

describe("setupTerminal — validação de entrada e confirmação de resposta", () => {
  it("id vazio rejeita antes do PATCH", async () => {
    const { client, calls } = makeClient()
    await expect(
      setupTerminal(client, { id: "", operatingMode: "PDV" })
    ).rejects.toBeInstanceOf(MpContractError)
    expect(calls).toHaveLength(0)
  })

  it("operatingMode desconhecido rejeita antes do PATCH", async () => {
    const { client, calls } = makeClient()
    await expect(
      setupTerminal(client, {
        id: "NEWLAND_N950__SBX0000001",
        operatingMode: "VOUCHER" as "PDV",
      })
    ).rejects.toBeInstanceOf(MpContractError)
    expect(calls).toHaveLength(0)
  })

  it("resposta com id DIFERENTE do solicitado falha fechada", async () => {
    const { client } = makeClient([
      { terminals: [{ id: "OUTRO__ID", operating_mode: "PDV" }] },
    ])
    await expect(
      setupTerminal(client, {
        id: "NEWLAND_N950__SBX0000001",
        operatingMode: "PDV",
      })
    ).rejects.toBeInstanceOf(MpContractError)
  })

  it("resposta que confere com o solicitado passa", async () => {
    const { client } = makeClient([SETUP_RESPONSE])
    const result = await setupTerminal(client, {
      id: "NEWLAND_N950__SBX0000001",
      operatingMode: "PDV",
    })
    expect(result.terminals[0]!.id).toBe("NEWLAND_N950__SBX0000001")
  })
})
