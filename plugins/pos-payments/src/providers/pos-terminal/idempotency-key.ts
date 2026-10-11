/** Chave de idempotência MP — UUID v5 canônico determinístico (D4).
 * Módulo puro próprio: service-mp importa a keyFor e service-mp-ops importa
 * o PROVIDER_LOG_ID de service-mp — o cruzamento entre os dois criaria
 * ciclo de import. */
import { uuidV5 } from "../../utils/uuid5"

/** Namespace v5 do plugin: uuidV5("@voolulabs/medusajs-plugin-pos-payments",
 * NAMESPACE_DNS). Constante LITERAL — chaves já emitidas na MP não podem mudar
 * se a derivação for editada. */
const KEY_NAMESPACE = "6d3a64ec-2c34-51dc-a630-0990218647ec"

/** UUID v5 canônico de `<seed>:<purpose>` — a doc MP pede "UUID v4 ou random
 * string"; o v5 mantém o formato E é determinístico: retry da mesma operação
 * reusa a MESMA chave sem estado local. MESMA derivação na rota e no
 * provider (mpInitiate) — o replay de um corpo idêntico dedupa na adquirente. */
export function keyFor(seed: string, purpose: string): string {
  return uuidV5(`${seed}:${purpose}`, KEY_NAMESPACE)
}
