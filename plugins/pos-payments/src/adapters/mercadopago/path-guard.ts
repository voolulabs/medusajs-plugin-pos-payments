/** Guard SSRF compartilhado (SAST 2026-10-14): `path` é montado com parâmetros
 * que atravessam rotas admin (:id, query) — valida que NUNCA possa virar URL
 * absoluta ou mudar de host: exige barra inicial, proíbe qualquer esquema,
 * `//`, `..` e caracteres fora do alfabeto de URL path/query. O baseUrl dos
 * clients é constante do plugin (api.mercadopago.com) — o destino é sempre a
 * MP. Usado pelo OrdersClient e pelo OnboardingHttpClient. */
import { MpContractError } from "./types"

const SAFE_PATH_PATTERN =
  /^\/[A-Za-z0-9\-._~%!$&'()*+,;=:@/]*(\?[A-Za-z0-9\-._~%!$&'()*+,;=:@/?]*)?$/

export function assertSafePath(path: string): void {
  if (
    !SAFE_PATH_PATTERN.test(path) ||
    path.includes("//") ||
    path.includes("..")
  ) {
    throw new MpContractError(
      "mercadopago: path de API inválido (guard SSRF — destino fixo api.mercadopago.com)"
    )
  }
}
