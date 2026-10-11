import { describe, expect, it } from "vitest"
import { GET } from "../charges/[id]/route"
import { POST } from "../charges/route"
import { makeReq, makeRes } from "./routes.helpers"

/**
 * Mapeamento erro → resposta (tabela da spec). O HTTP sai do error-handler do
 * core (verificado no framework 2.19): invalid_data/not_allowed → 400,
 * not_found → 404, unexpected_state → 500 com a mensagem preservada.
 */
describe("mapeamento de erros das rotas de charge", () => {
  it("404 da adquirente → not_found", async () => {
    const { req } = makeReq({
      params: { id: "ORD-404" },
      queue: [{ status: 404, body: { message: "order not found" } }],
    })
    await expect(GET(req, makeRes())).rejects.toMatchObject({
      type: "not_found",
      message: expect.stringContaining("não encontrada"),
    })
  })

  it("5xx da adquirente → unexpected_state com método/path/status (controlado)", async () => {
    const { req } = makeReq({
      params: { id: "ORD-1" },
      queue: [{ status: 500, body: { error: "internal_error" } }],
    })
    await expect(GET(req, makeRes())).rejects.toMatchObject({
      type: "unexpected_state",
      message: expect.stringContaining("HTTP 500"),
    })
  })

  it("erro desconhecido (rede) → mensagem genérica, sem eco do mundo externo", async () => {
    const { req } = makeReq({
      params: { id: "ORD-1" },
      plugin: {
        fetchImpl: (async () => {
          throw new TypeError("fetch failed com segredo-que-nao-eco")
        }) as unknown as typeof fetch,
      },
    })
    await expect(GET(req, makeRes())).rejects.toMatchObject({
      type: "unexpected_state",
      message: "pos-payments: falha inesperada na operação com a adquirente",
    })
  })

  it("409 sem ordem achada na reconsulta → unexpected_state", async () => {
    const { req } = makeReq({
      body: {
        amountMinor: 1999,
        externalReference: "ps_01ABC",
        terminalId: "NEWLAND_N950__S1",
      },
      queue: [
        { status: 409, body: { error: "idempotency_key_already_used" } },
        { status: 200, body: { data: [] } },
      ],
    })
    await expect(POST(req, makeRes())).rejects.toMatchObject({
      type: "unexpected_state",
    })
  })

  it("busca fora do contrato (data não é lista) → unexpected_state", async () => {
    const { req } = makeReq({
      body: {
        amountMinor: 1999,
        externalReference: "ps_01ABC",
        terminalId: "NEWLAND_N950__S1",
      },
      queue: [
        { status: 409, body: { error: "idempotency_key_already_used" } },
        { status: 200, body: { data: "não-sou-lista" } },
      ],
    })
    await expect(POST(req, makeRes())).rejects.toMatchObject({
      type: "unexpected_state",
      message: expect.stringContaining("fora do contrato"),
    })
  })
})
