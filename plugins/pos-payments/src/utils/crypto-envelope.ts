/** Envelope AES-256-GCM das credenciais de adquirente (engenharia.md §3.4,
 * secret-manager.md): master key FORA do banco (env), rotação dual-key.
 * Formato: `posp.v1.<keyId>.<iv>.<tag>.<ct>` (base64url); keyId = 8 hex de
 * SHA-256(key) — o envelope declara que chave o cifrou (rotação sem ambiguidade). */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto"

const PREFIX = "posp.v1"
const IV_BYTES = 12
const TAG_BYTES = 16

export class CryptoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CryptoError"
  }
}

export type MasterKeySet = { current: Buffer; previous?: Buffer }

/** Parse fail-closed de hex 32B — ausência/vazio/tamanho errado = CryptoError. */
function parseKey(raw: string | undefined, label: string): Buffer {
  if (!raw || raw.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new CryptoError(
      `${label} ausente ou inválida (esperado hex de 32 bytes) — CONSTRAINTS 4/8`
    )
  }
  return Buffer.from(raw, "hex")
}

export function keySetFromEnv(
  env: Record<string, string | undefined>
): MasterKeySet {
  const current = parseKey(
    env.POS_PAYMENTS_MASTER_KEY,
    "POS_PAYMENTS_MASTER_KEY"
  )
  const prev = env.POS_PAYMENTS_MASTER_KEY_PREVIOUS
  return {
    current,
    ...(prev
      ? { previous: parseKey(prev, "POS_PAYMENTS_MASTER_KEY_PREVIOUS") }
      : {}),
  }
}

export function keyIdOf(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8)
}

function b64url(b: Buffer): string {
  return b.toString("base64url")
}

/** Sempre cifra com a chave CORRENTE (gravação nova nunca usa a anterior). */
export function encryptSecret(plain: string, keys: MasterKeySet): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv("aes-256-gcm", keys.current, iv)
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    PREFIX,
    keyIdOf(keys.current),
    b64url(iv),
    b64url(tag),
    b64url(ct),
  ].join(".")
}

/** Descriptografa casando o keyId do envelope com a chave (corrente ou
 * anterior). Envelope adulterado/desconhecido = CryptoError — nunca lixo. */
export function decryptSecret(envelope: string, keys: MasterKeySet): string {
  const env = parseEnvelope(envelope)
  const key = selectKey(env.keyId, keys)
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(env.iv, "base64url")
    )
    decipher.setAuthTag(Buffer.from(env.tag, "base64url"))
    return Buffer.concat([
      decipher.update(Buffer.from(env.ct, "base64url")),
      decipher.final(),
    ]).toString("utf8")
  } catch {
    throw new CryptoError("envelope não autenticado (tag GCM)")
  }
}

interface EnvelopeParts {
  keyId: string
  iv: string
  tag: string
  ct: string
}

function parseEnvelope(envelope: string): EnvelopeParts {
  const parts = envelope.split(".")
  const [, , keyId, iv, tag, ct] = parts
  if (
    `${parts[0]}.${parts[1]}` !== PREFIX ||
    parts.length !== 6 ||
    !keyId ||
    !iv ||
    !tag ||
    !ct
  ) {
    throw new CryptoError("envelope inválido (prefixo/estrutura)")
  }
  return { keyId, iv, tag, ct }
}

/** Casamento keyId → chave (corrente ou anterior na rotação dual-key). */
function selectKey(keyId: string, keys: MasterKeySet): Buffer {
  if (keyId === keyIdOf(keys.current)) return keys.current
  if (keys.previous && keyId === keyIdOf(keys.previous)) return keys.previous
  throw new CryptoError(
    `envelope com keyId desconhecido (${keyId}) — rotação sem dual-key?`
  )
}
