import { createHmac } from "node:crypto"
import { describe, expect, it } from "vitest"
import { validateWebhookSignature } from "../webhook-signature"

const SECRET = "segredo-webhook-fixture"

/**
 * Assina com a fórmula OFICIAL (notifications MP, verificado 2026-10-05) —
 * independente do helper do plugin: o data.id entra no canonical em LOWERCASE
 * ("If data.id is returned with uppercase alphanumeric characters, convert it
 * to lowercase before using it in the manifest").
 */
function assinar(id: string, requestId: string, ts: string): string {
  return createHmac("sha256", SECRET)
    .update(`id:${id.toLowerCase()};request-id:${requestId};ts:${ts};`)
    .digest("hex")
}

function headers(id: string, requestId: string, ts: string) {
  return {
    "x-request-id": requestId,
    "x-signature": `ts=${ts},v1=${assinar(id, requestId, ts)}`,
  }
}

describe("validateWebhookSignature (formato oficial)", () => {
  it("aceita assinatura válida do formato oficial", () => {
    expect(
      validateWebhookSignature(
        headers("ORD1", "rid-1", "1700000000"),
        { data: { id: "ORD1" } },
        SECRET
      )
    ).toBe(true)
  })

  it("é insensível ao caso do hex (MP manda minúsculo, mas não confia)", () => {
    const h = headers("ORD1", "rid-1", "1700000000")
    h["x-signature"] =
      `ts=1700000000,v1=${assinar("ORD1", "rid-1", "1700000000").toUpperCase()}`
    expect(validateWebhookSignature(h, { data: { id: "ORD1" } }, SECRET)).toBe(
      true
    )
  })

  it("rejeita payload adulterado (id divergente do assinado)", () => {
    expect(
      validateWebhookSignature(
        headers("ORD1", "rid-1", "1700000000"),
        { data: { id: "ORD2" } },
        SECRET
      )
    ).toBe(false)
  })

  it("rejeita secret errado, request-id alterado e ts alterado", () => {
    const h = headers("ORD1", "rid-1", "1700000000")
    expect(
      validateWebhookSignature(h, { data: { id: "ORD1" } }, "outro-secret")
    ).toBe(false)
    expect(
      validateWebhookSignature(
        { ...h, "x-request-id": "rid-2" },
        { data: { id: "ORD1" } },
        SECRET
      )
    ).toBe(false)
    // ts trocado no header com a assinatura ORIGINAL: o canonical usa o ts do
    // header, que diverge do ts assinado — rejeita.
    expect(
      validateWebhookSignature(
        {
          ...h,
          "x-signature": `ts=1700000001,v1=${assinar("ORD1", "rid-1", "1700000000")}`,
        },
        { data: { id: "ORD1" } },
        SECRET
      )
    ).toBe(false)
  })

  it("falha fechado sem ts/v1/request-id/secret/id", () => {
    expect(validateWebhookSignature({}, { data: { id: "ORD1" } }, SECRET)).toBe(
      false
    )
    expect(
      validateWebhookSignature(
        { "x-request-id": "r", "x-signature": "v1=abc" },
        { data: { id: "ORD1" } },
        SECRET
      )
    ).toBe(false)
    expect(
      validateWebhookSignature(headers("ORD1", "r", "1"), { data: {} }, SECRET)
    ).toBe(false)
    expect(
      validateWebhookSignature(
        headers("ORD1", "r", "1"),
        { data: { id: "ORD1" } },
        ""
      )
    ).toBe(false)
  })
})

describe("validateWebhookSignature (lowercase do data.id — nota oficial)", () => {
  it("id maiúsculo no envelope casa com a assinatura do id em lowercase", () => {
    // Cenário REAL do L3: MP entrega data.id maiúsculo (ORDTST...) e assina o
    // canonical com o id em lowercase. Sem o lowercase no validador, toda
    // entrega real era descartada.
    expect(
      validateWebhookSignature(
        headers("ORDTST01M46YGB9K0CKPNAM43XSYE1WH", "rid-real", "1791235590"),
        {
          data: { id: "ORDTST01M46YGB9K0CKPNAM43XSYE1WH" },
        },
        SECRET
      )
    ).toBe(true)
  })

  it("assinatura computada sobre o id maiúsculo NÃO casa (canonical é lowercase)", () => {
    const ts = "1700000000"
    const requestId = "rid-1"
    const h = {
      "x-request-id": requestId,
      "x-signature": `ts=${ts},v1=${createHmac("sha256", SECRET)
        .update(`id:ORD1;request-id:${requestId};ts:${ts};`)
        .digest("hex")}`,
    }
    expect(validateWebhookSignature(h, { data: { id: "ORD1" } }, SECRET)).toBe(
      false
    )
  })
})
