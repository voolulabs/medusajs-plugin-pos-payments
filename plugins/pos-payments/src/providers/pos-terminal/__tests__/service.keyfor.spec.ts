import { describe, expect, it } from "vitest"
import { keyFor } from "../service-mp-ops"

const UUID_V5 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe("keyFor — uuidv5 determinístico (D4, doc MP: UUID v4 ou string aleatória)", () => {
  it("devolve UUID canônico versão 5, variante RFC", () => {
    expect(keyFor("ORD-1", "cancel")).toMatch(UUID_V5)
  })

  it("golden value — vetor de implementação independente (python uuid.uuid5)", () => {
    expect(keyFor("ORD-1", "cancel")).toBe(
      "058ef3c5-a31e-505b-8c3a-e1693db35cca"
    )
  })

  it("determinístico: mesma charge+purpose → mesma chave", () => {
    expect(keyFor("ORD-9", "refund")).toBe(keyFor("ORD-9", "refund"))
  })

  it("purposes distintas → chaves distintas", () => {
    expect(keyFor("ORD-1", "cancel")).not.toBe(keyFor("ORD-1", "create"))
  })

  it("charges distintas → chaves distintas", () => {
    expect(keyFor("ORD-1", "cancel")).not.toBe(keyFor("ORD-2", "cancel"))
  })
})
