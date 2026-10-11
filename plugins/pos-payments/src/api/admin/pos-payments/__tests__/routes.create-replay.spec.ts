import { describe, expect, it } from "vitest"
import { POST } from "../charges/route"
import { VALID_BODY, makeReq, makeRes } from "./routes.helpers"

/** Replay de idempotência e validação da fronteira (400 antes da adquirente). */
describe("POST /charges — replay de idempotência", () => {
  it("409 sem ordem achada relança (nunca recria)", async () => {
    const { req, calls } = makeReq({
      body: VALID_BODY,
      queue: [
        { status: 409, body: { error: "idempotency_key_already_used" } },
        { status: 200, body: { data: [] } },
      ],
    })
    await expect(POST(req, makeRes())).rejects.toMatchObject({
      type: "unexpected_state",
    })
    expect(calls).toHaveLength(2)
    expect(calls[1]!.url).toContain("external_reference=ps_01ABC")
  })

  it("replay com a ordem existente devolve a mesma cobrança", async () => {
    const { req, calls } = makeReq({
      body: VALID_BODY,
      queue: [
        { status: 409, body: { error: "idempotency_key_already_used" } },
        {
          status: 200,
          body: {
            data: [
              {
                id: "ORD-77",
                status: "at_terminal",
                type: "point",
                external_reference: VALID_BODY.externalReference,
                config: { point: { terminal_id: VALID_BODY.terminalId } },
                transactions: {
                  payments: [
                    {
                      id: "PAY-1",
                      amount: "19.99",
                      status: "waiting_payment",
                    },
                  ],
                },
              },
            ],
          },
        },
        {
          status: 200,
          body: {
            id: "ORD-77",
            status: "at_terminal",
            type: "point",
            external_reference: VALID_BODY.externalReference,
            config: { point: { terminal_id: VALID_BODY.terminalId } },
            transactions: {
              payments: [
                {
                  id: "PAY-1",
                  amount: "19.99",
                  status: "waiting_payment",
                },
              ],
            },
          },
        },
      ],
    })
    const res = makeRes()
    await POST(req, res)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ chargeId: "ORD-77" })
    )
    expect(calls).toHaveLength(3)
  })
})

describe("POST /charges — validação fail-closed da fronteira", () => {
  it("400 para amount com fração (dinheiro nunca é display units)", async () => {
    const { req } = makeReq({
      body: { ...VALID_BODY, amountMinor: 19.99 },
    })
    await expect(POST(req, makeRes())).rejects.toMatchObject({
      type: "invalid_data",
    })
  })

  it("400 para external_reference fora do alfabeto (sem PII)", async () => {
    const { req } = makeReq({
      body: { ...VALID_BODY, externalReference: "cliente joão 2" },
    })
    await expect(POST(req, makeRes())).rejects.toMatchObject({
      type: "invalid_data",
    })
  })

  it("expirationTime na janela passa; fora da janela é 400 na fronteira", async () => {
    const ok = makeReq({
      body: { ...VALID_BODY, expirationTime: "PT15M" },
    })
    await POST(ok.req, makeRes())
    const payload = JSON.parse(String(ok.calls[0]!.init.body)) as {
      expiration_time: string
    }
    expect(payload.expiration_time).toBe("PT15M")

    for (const fora of ["PT10S", "PT4H", "15min"]) {
      const bad = makeReq({ body: { ...VALID_BODY, expirationTime: fora } })
      await expect(POST(bad.req, makeRes())).rejects.toMatchObject({
        type: "invalid_data",
      })
    }
  })
})
