import { describe, expect, it } from "vitest"
import { NAMESPACE_DNS, NAMESPACE_URL, uuidV5 } from "../uuid5"

describe("uuidV5 — RFC 4122 §4.3 (SHA-1, sem dependência nova)", () => {
  it("vetores de implementação independente (python uuid.uuid5)", () => {
    expect(uuidV5("hello", NAMESPACE_DNS)).toBe(
      "9342d47a-1bab-5709-9869-c840b2eac501"
    )
    expect(uuidV5("hello", NAMESPACE_URL)).toBe(
      "074171de-bc84-5ea4-b636-1135477620e1"
    )
  })

  it("saída canônica: versão 5 no nibble alto e variante 10xx", () => {
    const v = uuidV5("qualquer", NAMESPACE_DNS)
    expect(v).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
  })

  it("namespaces distintos produzem UUIDs distintos para o mesmo nome", () => {
    expect(uuidV5("hello", NAMESPACE_DNS)).not.toBe(
      uuidV5("hello", NAMESPACE_URL)
    )
  })

  it("determinístico", () => {
    expect(uuidV5("x", NAMESPACE_DNS)).toBe(uuidV5("x", NAMESPACE_DNS))
  })
})
