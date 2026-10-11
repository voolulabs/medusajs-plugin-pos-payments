import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"

// ADR 0005: rotas do plugin vivem sob /admin/pos-payments/* e usam a auth
// do core - SEM middleware próprio (middlewares.ts nao existe neste plugin).

/** GET /admin/pos-payments/health — contratos: Fase 1 `{status:"ok"}` +
 * Fase 2b: resumo de conexões por adquirente (NÃO-sensível — sem segredos,
 * onboarding.md §10: o app marca método indisponível no tender com motivo). */
export async function GET(
  _req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  let connections: Array<Record<string, unknown>> = []
  try {
    const module = _req.scope.resolve("posPayments") as {
      listPosPaymentsConnections: (
        f: unknown
      ) => Promise<Array<Record<string, unknown>>>
    }
    const rows = await module.listPosPaymentsConnections({})
    connections = rows.map((row) => ({
      acquirer: row.acquirer,
      status: row.status,
      actionReason: row.actionReason ?? null,
      expiresAt: row.expiresAt ?? null,
      lastValidatedAt: row.lastValidatedAt ?? null,
    }))
  } catch {
    // Sem o módulo (deploy pendente de db:migrate): health segue "ok" para o
    // core, com a lista vazia — o diagnóstico do onboarding aponta o motivo.
    connections = []
  }
  res.status(200).json({
    status: "ok",
    plugin: "@voolulabs/medusajs-plugin-pos-payments",
    mode: "manual (terminal-presente)",
    connections,
  })
}
