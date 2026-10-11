import { describe, expect, it, vi } from "vitest"
import { GET } from "../route"

// Health sob /admin/pos-payments/* (ADR 0005): auth é do core — o handler só
// responde o payload. Fase 2b: resumo de conexões NÃO-sensível (sem segredos);
// sem o módulo no container (deploy pendente de db:migrate) a lista vem vazia
// e o health segue "ok" para o core.
describe("GET /admin/pos-payments/health", () => {
  it("responde 200 com o payload do plugin + conexões vazias", async () => {
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    }
    await GET({ scope: { resolve: () => undefined } } as never, res as never)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      status: "ok",
      plugin: "@voolulabs/medusajs-plugin-pos-payments",
      mode: "manual (terminal-presente)",
      connections: [],
    })
  })

  it("nunca vaza segredos no resumo de conexões", async () => {
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    }
    const module = {
      listPosPaymentsConnections: async () => [
        {
          acquirer: "mercadopago",
          status: "connected",
          actionReason: null,
          expiresAt: null,
          lastValidatedAt: null,
          credential: "NÃO-DEVE-SAIR",
        },
      ],
    }
    await GET({ scope: { resolve: () => module } } as never, res as never)
    const payload = JSON.stringify(res.json.mock.calls[0]![0])
    expect(payload).not.toContain("NÃO-DEVE-SAIR")
    expect(payload).not.toContain("access_token")
  })
})
