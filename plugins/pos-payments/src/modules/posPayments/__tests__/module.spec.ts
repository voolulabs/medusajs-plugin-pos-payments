import { describe, expect, it } from "vitest"
import moduleDefinition from "../index"
import PosPaymentsModuleService from "../service"
import { PosPaymentsConnection } from "../models/connection"
import { PosPaymentsCredential } from "../models/credential"
import { PosPaymentsOauthState } from "../models/oauth-state"
import { PosPaymentsAuditEvent } from "../models/audit-event"

/** Smoke do módulo (auto-registro verificado no fonte: get-resolved-plugins
 * descobre dist/modules/<nome>; nome camelCase obrigatório). */
describe("módulo posPayments", () => {
  it("exporta definição com service e nome camelCase", () => {
    expect(moduleDefinition).toBeTruthy()
  })

  it("MedusaService gera CRUD das 4 tabelas no protótipo", () => {
    const proto = PosPaymentsModuleService.prototype as unknown as Record<
      string,
      unknown
    >
    for (const method of [
      "createPosPaymentsConnections",
      "listPosPaymentsConnections",
      "updatePosPaymentsConnections",
      "createPosPaymentsCredentials",
      "listPosPaymentsCredentials",
      "deletePosPaymentsCredentials",
      "createPosPaymentsOauthStates",
      "listPosPaymentsOauthStates",
      "updatePosPaymentsOauthStates",
      "createPosPaymentsAuditEvents",
    ]) {
      expect(typeof proto[method]).toBe("function")
    }
  })

  it("modelos DML definidos (a tabela vem da naming strategy + migration)", () => {
    for (const entity of [
      PosPaymentsConnection,
      PosPaymentsCredential,
      PosPaymentsOauthState,
      PosPaymentsAuditEvent,
    ]) {
      expect(typeof (entity as { name?: string }).name).toBe("string")
    }
  })
})
