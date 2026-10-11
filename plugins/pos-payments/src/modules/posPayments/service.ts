import { MedusaService } from "@medusajs/framework/utils"
import { PosPaymentsAuditEvent } from "./models/audit-event"
import { PosPaymentsConnection } from "./models/connection"
import { PosPaymentsCredential } from "./models/credential"
import { PosPaymentsOauthState } from "./models/oauth-state"

/** CRUD tipado das 4 tabelas de onboarding (onboarding.md §5.2). Mutações de
 * fluxo (desconexão, rotação, consumo de state) passam pelos serviços de
 * onboarding (src/services/onboarding) — aqui só a persistência genérica. */
class PosPaymentsModuleService extends MedusaService({
  PosPaymentsConnection,
  PosPaymentsCredential,
  PosPaymentsOauthState,
  PosPaymentsAuditEvent,
}) {}

export default PosPaymentsModuleService
export { PosPaymentsModuleService }
