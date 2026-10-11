import { describe, expect, it } from "vitest"
import {
  CryptoError,
  decryptSecret,
  encryptSecret,
  keyIdOf,
  keySetFromEnv,
} from "../crypto-envelope"

const K1 = "a".repeat(64)
const K2 = "b".repeat(64)
const keys1 = keySetFromEnv({ POS_PAYMENTS_MASTER_KEY: K1 })
const rotated = keySetFromEnv({
  POS_PAYMENTS_MASTER_KEY: K2,
  POS_PAYMENTS_MASTER_KEY_PREVIOUS: K1,
})

describe("crypto-envelope", () => {
  it("faz roundtrip e declara o keyId da chave corrente", () => {
    const env = encryptSecret("token-do-lojista", keys1)
    expect(env.startsWith("posp.v1.")).toBe(true)
    expect(env.split(".")[2]).toBe(keyIdOf(Buffer.from(K1, "hex")))
    expect(decryptSecret(env, keys1)).toBe("token-do-lojista")
  })

  it("rotação dual-key: envelope da chave antiga continua legível", () => {
    const env = encryptSecret("segredo", keys1)
    expect(decryptSecret(env, rotated)).toBe("segredo")
  })

  it("nova gravação pós-rotação usa a chave corrente", () => {
    const env = encryptSecret("novo", rotated)
    expect(env.split(".")[2]).toBe(keyIdOf(Buffer.from(K2, "hex")))
    expect(decryptSecret(env, rotated)).toBe("novo")
  })

  it("envelope adulterado (tag GCM) falha sem vazar plaintext", () => {
    const env = encryptSecret("segredo", keys1)
    const parts = env.split(".")
    const ct = Buffer.from(parts[4]!, "base64url")
    ct[0] = ct[0]! ^ 0xff
    const tampered = [...parts.slice(0, 4), ct.toString("base64url")].join(".")
    expect(() => decryptSecret(tampered, keys1)).toThrow(CryptoError)
  })

  it("envelope com keyId desconhecido falha (rotação sem dual-key)", () => {
    const env = encryptSecret("segredo", keys1)
    expect(() =>
      decryptSecret(env, keySetFromEnv({ POS_PAYMENTS_MASTER_KEY: K2 }))
    ).toThrow(/keyId desconhecido/)
  })

  it("fail-closed: sem master key, parse e cifra levantam CryptoError", () => {
    expect(() => keySetFromEnv({})).toThrow(CryptoError)
    expect(() => keySetFromEnv({ POS_PAYMENTS_MASTER_KEY: "curta" })).toThrow(
      /ausente ou inválida/
    )
    expect(() => encryptSecret("x", keySetFromEnv({}))).toThrow(CryptoError)
  })

  it("estrutura: iv de 12 bytes e ct não-trivial", () => {
    const a = encryptSecret("mesmo-texto", keys1)
    const b = encryptSecret("mesmo-texto", keys1)
    expect(a).not.toBe(b) // iv aleatório
    expect(Buffer.from(a.split(".")[3]!, "base64url").length).toBe(12)
  })
})
