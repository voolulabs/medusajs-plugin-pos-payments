import { describe, expect, it } from "vitest"
import { makeClient } from "./helpers"

describe("createPointOrder — validações fail-closed antes do fetch", () => {
  it("rejeita amount sem duas casas decimais sem chamar a API", async () => {
    const { client, calls, fixedKey } = makeClient()
    await expect(
      client.createPointOrder(
        {
          amount: "10",
          externalReference: "x",
          terminalId: "NEWLAND_N950__S1",
        },
        fixedKey
      )
    ).rejects.toThrow(/2 casas/)
    expect(calls).toHaveLength(0)
  })

  it("rejeita amount zero e terminal sem o formato {tipo}__{serial}", async () => {
    const { client, calls, fixedKey } = makeClient()
    await expect(
      client.createPointOrder(
        {
          amount: "0.00",
          externalReference: "x",
          terminalId: "NEWLAND_N950__S1",
        },
        fixedKey
      )
    ).rejects.toThrow(/positiva/)
    await expect(
      client.createPointOrder(
        { amount: "1.00", externalReference: "x", terminalId: "SEMFORMATO" },
        fixedKey
      )
    ).rejects.toThrow(/terminal_id/)
    expect(calls).toHaveLength(0)
  })

  it.each(["com acento", "tem;pi", "a".repeat(65), ""])(
    "rejeita external_reference fora de [A-Za-z0-9-_]{1,64}: %s",
    async (reference) => {
      const { client, calls, fixedKey } = makeClient()
      await expect(
        client.createPointOrder(
          {
            amount: "1.00",
            externalReference: reference,
            terminalId: "NEWLAND_N950__S1",
          },
          fixedKey
        )
      ).rejects.toThrow(/external_reference/)
      expect(calls).toHaveLength(0)
    }
  )

  it("rejeita description acima de 150 caracteres e expiration fora da janela", async () => {
    const { client, calls, fixedKey } = makeClient()
    await expect(
      client.createPointOrder(
        {
          amount: "1.00",
          externalReference: "ok",
          terminalId: "NEWLAND_N950__S1",
          description: "x".repeat(151),
        },
        fixedKey
      )
    ).rejects.toThrow(/150 caracteres/)
    await expect(
      client.createPointOrder(
        {
          amount: "1.00",
          externalReference: "ok",
          terminalId: "NEWLAND_N950__S1",
          expirationTime: "PT10S",
        },
        fixedKey
      )
    ).rejects.toThrow(/PT30S/)
    expect(calls).toHaveLength(0)
  })
})
