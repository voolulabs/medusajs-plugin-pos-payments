import { beforeEach, describe, expect, it } from "vitest"
import { consumeState, issueState } from "../oauth-state"
import { fakeModule } from "./helpers"

describe("oauth-state (AC2: single-use/expira)", () => {
  let mod: ReturnType<typeof fakeModule>
  beforeEach(() => {
    mod = fakeModule()
  })

  it("issueState gera CSPRNG com expiração ≤10min e ator", async () => {
    const state = await issueState(mod.svc as never, "mercadopago", "admin-1")
    expect(state).toMatch(/^[0-9a-f]{64}$/)
    const row = (mod.db.states as Array<Record<string, unknown>>).slice(-1)[0]!
    expect(row.acquirer).toBe("mercadopago")
    expect(row.actorId).toBe("admin-1")
    const exp = (row.expiresAt as Date).getTime() - Date.now()
    expect(exp).toBeGreaterThan(9 * 60 * 1000)
    expect(exp).toBeLessThanOrEqual(10 * 60 * 1000)
  })

  it("consumeState: 1ª leitura ok e marca used_at; 2ª rejeita (used)", async () => {
    const state = await issueState(mod.svc as never, "mercadopago", "admin-1")
    const first = await consumeState(mod.svc as never, state, "mercadopago")
    expect(first).toEqual({ ok: true, actorId: "admin-1" })
    const second = await consumeState(mod.svc as never, state, "mercadopago")
    expect(second).toEqual({ ok: false, reason: "used" })
  })

  it("state expirado rejeita (expired)", async () => {
    await mod.svc.createPosPaymentsOauthStates([
      {
        state: "velho",
        acquirer: "mercadopago",
        actorId: "admin-1",
        expiresAt: new Date(Date.now() - 1000),
        usedAt: null,
      },
    ])
    expect(
      await consumeState(mod.svc as never, "velho", "mercadopago")
    ).toEqual({
      ok: false,
      reason: "expired",
    })
  })

  it("state inexistente ou de outro adquirente rejeita (not_found)", async () => {
    expect(
      await consumeState(mod.svc as never, "fantasma", "mercadopago")
    ).toEqual({
      ok: false,
      reason: "not_found",
    })
    await issueState(mod.svc as never, "mercadopago", "admin-1")
    const row = (mod.db.states as Array<Record<string, unknown>>).slice(-1)[0]!
    expect(
      await consumeState(mod.svc as never, row.state as string, "sumup")
    ).toEqual({
      ok: false,
      reason: "not_found",
    })
  })
})
