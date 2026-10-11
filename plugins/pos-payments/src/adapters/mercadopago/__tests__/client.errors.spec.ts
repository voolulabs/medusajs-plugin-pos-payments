import { describe, expect, it } from "vitest"
import { makeClient, jsonResponse } from "./helpers"
import {
  MpApiError,
  MpContractError,
  MpIdempotencyConflictError,
} from "../types"

describe("erros HTTP e fail-closed", () => {
  it("não-2xx lança MpApiError com status e body", async () => {
    const { client, calls, fetchImpl } = makeClient()
    fetchImpl.mockImplementationOnce(
      async (url: string | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init: init ?? {} })
        return jsonResponse({ message: "order not found" }, 404)
      }
    )
    const promise = client.getOrder("missing")
    await expect(promise).rejects.toBeInstanceOf(MpApiError)
    await promise.catch((error: MpApiError) => {
      expect(error.status).toBe(404)
      expect(error.body).toEqual({ message: "order not found" })
      expect(error.message).toContain("404")
    })
  })

  it("409 de colisão de idempotência vira MpIdempotencyConflictError", async () => {
    const { client, fetchImpl } = makeClient()
    fetchImpl.mockImplementationOnce(async () =>
      jsonResponse(
        { error: "idempotency_key_already_used", message: "duplicated" },
        409
      )
    )
    await expect(client.getOrder("ORD-1")).rejects.toBeInstanceOf(
      MpIdempotencyConflictError
    )
  })

  it("409 de OUTRA origem continua MpApiError comum", async () => {
    const { client, fetchImpl } = makeClient()
    fetchImpl.mockImplementation(async () =>
      jsonResponse({ error: "already_queued_order_on_terminal" }, 409)
    )
    const promise = client.getOrder("ORD-1")
    await expect(promise).rejects.toBeInstanceOf(MpApiError)
    await promise.catch((error: unknown) => {
      expect(error).not.toBeInstanceOf(MpIdempotencyConflictError)
    })
  })

  it("resposta 2xx fora do contrato falha fechada (MpContractError)", async () => {
    const { client, fetchImpl } = makeClient()
    fetchImpl.mockImplementationOnce(
      async () =>
        new Response(JSON.stringify({ unexpected: true }), { status: 200 })
    )
    await expect(client.getOrder("ORD-1")).rejects.toBeInstanceOf(
      MpContractError
    )
  })

  it("body de erro não-JSON não quebra o parse (vira body vazio)", async () => {
    const { client, fetchImpl } = makeClient()
    fetchImpl.mockImplementationOnce(
      async () => new Response("html de erro", { status: 500 })
    )
    await expect(client.getOrder("x")).rejects.toMatchObject({ status: 500 })
  })

  it("timeout duro: AbortSignal presente no fetch", async () => {
    const { client, calls, fixedKey } = makeClient()
    await client.createPointOrder(
      {
        amount: "1.00",
        externalReference: "ok",
        terminalId: "NEWLAND_N950__S1",
      },
      fixedKey
    )
    const init = calls[0]!.init as RequestInit & { signal?: AbortSignal }
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})
