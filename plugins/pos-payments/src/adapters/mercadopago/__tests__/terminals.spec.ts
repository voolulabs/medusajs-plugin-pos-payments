import { describe, expect, it } from "vitest"
import { makeClient, SETUP_RESPONSE, TERMINALS_PAGE } from "./helpers"
import {
  listTerminals,
  setupTerminal,
  terminalsQueryString,
} from "../terminals"

describe("terminalsQueryString — serialização pura", () => {
  it("serializa limit/offset/store_id/pos_id na ordem esperada", () => {
    expect(
      terminalsQueryString({ limit: 10, offset: 5, storeId: "S1", posId: "P1" })
    ).toBe("limit=10&offset=5&store_id=S1&pos_id=P1")
    expect(terminalsQueryString({})).toBe("")
  })
})

describe("listTerminals — GET /terminals/v1/list", () => {
  it("sem query: URL nua, GET sem idempotency key, página parseada", async () => {
    const { client, calls } = makeClient([TERMINALS_PAGE])
    const page = await listTerminals(client)
    expect(calls[0]!.url).toBe("https://api.test/terminals/v1/list")
    expect(calls[0]!.init.method).toBe("GET")
    expect(
      (calls[0]!.init.headers as Record<string, string>)["X-Idempotency-Key"]
    ).toBeUndefined()
    expect(page.data.terminals[0]).toMatchObject({ operating_mode: "PDV" })
    expect(page.paging.total).toBe(1)
  })

  it("query vai na URL na ordem esperada", async () => {
    const { client, calls } = makeClient([TERMINALS_PAGE])
    await listTerminals(client, { limit: 10, storeId: "47792478" })
    expect(calls[0]!.url).toBe(
      "https://api.test/terminals/v1/list?limit=10&store_id=47792478"
    )
  })
})

describe("setupTerminal — PATCH /terminals/v1/setup", () => {
  it("envia UM terminal no body ({id, operating_mode}) e sem idempotency key", async () => {
    const { client, calls } = makeClient([SETUP_RESPONSE])
    await setupTerminal(client, {
      id: "NEWLAND_N950__SBX0000001",
      operatingMode: "PDV",
    })
    expect(calls[0]!.url).toBe("https://api.test/terminals/v1/setup")
    expect(calls[0]!.init.method).toBe("PATCH")
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      terminals: [{ id: "NEWLAND_N950__SBX0000001", operating_mode: "PDV" }],
    })
    expect(
      (calls[0]!.init.headers as Record<string, string>)["X-Idempotency-Key"]
    ).toBeUndefined()
  })

  it("devolve os terminais atualizados parseados", async () => {
    const { client } = makeClient([SETUP_RESPONSE])
    const result = await setupTerminal(client, {
      id: "NEWLAND_N950__SBX0000001",
      operatingMode: "PDV",
    })
    expect(result.terminals[0]).toEqual({
      id: "NEWLAND_N950__SBX0000001",
      operating_mode: "PDV",
    })
  })
})
