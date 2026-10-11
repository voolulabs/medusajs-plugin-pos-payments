/** UUID v5 (RFC 4122 §4.3, SHA-1) via node:crypto — sem dependência nova (D4). */
import { createHash } from "node:crypto"
import { MedusaError } from "@medusajs/framework/utils"

/** Namespaces well-known da RFC (apenas como semente do namespace do plugin). */
export const NAMESPACE_DNS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"
export const NAMESPACE_URL = "6ba7b811-9dad-11d1-80b4-00c04fd430c8"

function namespaceToBytes(namespace: string): Buffer {
  const hex = namespace.replace(/-/g, "")
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
    // Regra do plugin: erro lança MedusaError (mapeia HTTP no error-handler).
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `uuid5: namespace inválido (esperado UUID canônico): ${namespace}`
    )
  }
  return Buffer.from(hex, "hex")
}

/** Versão 5 no nibble alto do byte 6 e variante 10xx no byte 8, forma canônica. */
function toCanonical(bytes: Buffer): string {
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function uuidV5(name: string, namespace: string): string {
  // FP auditado: SHA-1 e EXIGIDO pela RFC 4122 4.3 para UUIDv5 — nao e hash
  // de senha; SHA-256 produziria UUID nao conforme.
  const hash = createHash("sha1")
    .update(namespaceToBytes(namespace))
    .update(Buffer.from(name, "utf8"))
    .digest()
  return toCanonical(hash.subarray(0, 16))
}
