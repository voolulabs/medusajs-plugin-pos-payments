import { describe, expect, it } from "vitest"
import {
  createPos,
  createStore,
  deletePos,
  listPos,
  searchStores,
} from "../stores"
import { OnboardingHttpClient } from "../onboarding-client"
import { fakeFetch } from "../../../services/onboarding/__tests__/helpers"

const http = () => {
  const f = fakeFetch((call) => {
    if (call.url.includes("/stores/search"))
      return { body: { results: [{ id: 1, external_id: "unidade-1" }] } }
    if (call.url.includes("/v2/pos?"))
      return {
        body: {
          results: [{ id: 7, external_id: "stock-1", status: "active" }],
        },
      }
    if (call.method === "POST" && call.url.endsWith("/v2/pos"))
      return { status: 201, body: { id: 9, external_id: "stock-1" } }
    return { body: { id: 5 } }
  })
  return { ...f, client: new OnboardingHttpClient({ fetchImpl: f.fetchImpl }) }
}

describe("stores/pos CRUD (AC8: mercado-pago.md §10.1)", () => {
  it("createStore: POST /users/{user_id}/stores com external_id", async () => {
    const { calls, client } = http()
    await createStore(client, "tok", "42", {
      name: "Loja Centro",
      externalId: "unidade-1",
    })
    const call = calls[0]!
    expect(call.url).toBe("https://api.mercadopago.com/users/42/stores")
    expect(call.headers.authorization).toBe("Bearer tok")
    expect(JSON.parse(call.rawBody!)).toMatchObject({
      name: "Loja Centro",
      external_id: "unidade-1",
    })
  })

  it("searchStores devolve results; external_id vai na query", async () => {
    const { calls, client } = http()
    const stores = await searchStores(client, "tok", "42", {
      externalId: "unidade-1",
    })
    expect(calls[0]!.url).toContain(
      "/users/42/stores/search?external_id=unidade-1"
    )
    expect(stores).toHaveLength(1)
  })

  it("listPos: filtro external_id na query (lookup do vínculo)", async () => {
    const { calls, client } = http()
    const pos = await listPos(client, "tok", { externalId: "stock-1" })
    expect(calls[0]!.url).toBe(
      "https://api.mercadopago.com/v2/pos?external_id=stock-1"
    )
    expect(pos[0]!.id).toBe(7)
  })

  it("createPos: X-Idempotency-Key obrigatório + store externa; sem store → erro", async () => {
    const { calls, client } = http()
    await createPos(
      client,
      "tok",
      { externalId: "stock-1", externalStoreId: "unidade-1" },
      "2b7f1e2a-1111-4222-8333-444455556666"
    )
    const call = calls[0]!
    expect(call.method).toBe("POST")
    expect(call.headers["x-idempotency-key"]).toBe(
      "2b7f1e2a-1111-4222-8333-444455556666"
    )
    expect(JSON.parse(call.rawBody!)).toMatchObject({
      external_id: "stock-1",
      external_store_id: "unidade-1",
    })
    await expect(
      createPos(
        client,
        "tok",
        { externalId: "stock-2" },
        "2b7f1e2a-1111-4222-8333-444455556666"
      )
    ).rejects.toMatchObject({ code: "invalid_credential" })
    await expect(
      createPos(
        client,
        "tok",
        { externalId: "s", externalStoreId: "x" },
        "curta"
      )
    ).rejects.toMatchObject({ code: "invalid_credential" })
  })

  it("deletePos: DELETE /v2/pos/{id}", async () => {
    const { calls, client } = http()
    await deletePos(client, "tok", "9")
    expect(calls[0]!.method).toBe("DELETE")
    expect(calls[0]!.url).toBe("https://api.mercadopago.com/v2/pos/9")
  })
})
