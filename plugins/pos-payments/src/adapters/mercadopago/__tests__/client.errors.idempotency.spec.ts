/** Idempotency Errors retentáveis da doc oficial da Orders API (A10/W2.3). */
import { describe, expect, it } from "vitest"
import { makeClient, jsonResponse } from "./helpers"
import { MpApiError, MpIdempotencyRetryableError } from "../types"

describe("idempotency errors retentáveis (423/500 — doc oficial)", () => {
  it.each([
    [423, "resource_locked"],
    [500, "idempotency_validation_failed"],
  ] as const)(
    "HTTP %i %s vira MpIdempotencyRetryableError com o body original preservado",
    async (status, mpError) => {
      const { client, fetchImpl } = makeClient()
      const body = { error: mpError, message: "retryable" }
      fetchImpl.mockImplementationOnce(async () => jsonResponse(body, status))
      // rejects.* falha se a promise resolver (sem catch que pode ser pulado).
      await expect(client.getOrder("ORD-1")).rejects.toMatchObject({
        name: "MpIdempotencyRetryableError",
        status,
        body,
        retryable: true,
      })
    }
  )

  it.each([
    [423, "resource_locked"],
    [500, "idempotency_validation_failed"],
  ] as const)(
    "HTTP %i %s SEM Retry-After deixa o hint undefined",
    async (status, mpError) => {
      const { client, fetchImpl } = makeClient()
      const body = { error: mpError }
      fetchImpl.mockImplementationOnce(async () => jsonResponse(body, status))
      // rejects.* garante a rejeição; só então o erro é inspecionado.
      const error = await client.getOrder("ORD-1").then(
        () => {
          throw new Error("deveria ter rejeitado")
        },
        (e: MpIdempotencyRetryableError) => e
      )
      expect(error).toBeInstanceOf(MpIdempotencyRetryableError)
      expect(error.status).toBe(status)
      expect(error.body).toEqual(body)
      expect(error.retryAfter).toBeUndefined()
    }
  )

  it("423 resource_locked consome o Retry-After quando o server manda", async () => {
    const { client, fetchImpl } = makeClient()
    fetchImpl.mockImplementationOnce(async () =>
      jsonResponse({ error: "resource_locked", message: "locked" }, 423, {
        "Retry-After": "7",
      })
    )
    await expect(client.getOrder("ORD-1")).rejects.toMatchObject({
      status: 423,
      retryable: true,
      retryAfter: "7",
    })
  })

  it.each([
    [423, "outra_coisa_423"],
    [500, "internal_error"],
  ] as const)(
    "HTTP %i com erro fora da taxonomia de idempotência (%s) continua MpApiError comum",
    async (status, mpError) => {
      const { client, fetchImpl } = makeClient()
      fetchImpl.mockImplementationOnce(async () =>
        jsonResponse({ error: mpError }, status)
      )
      const promise = client.getOrder("ORD-1")
      await expect(promise).rejects.toBeInstanceOf(MpApiError)
      await expect(promise).rejects.not.toBeInstanceOf(
        MpIdempotencyRetryableError
      )
    }
  )
})
