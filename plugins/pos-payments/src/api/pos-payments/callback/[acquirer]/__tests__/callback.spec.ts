import { beforeEach, describe, expect, it } from "vitest"
import { GET as callback } from "../route"
import { issueState } from "../../../../../services/onboarding/oauth-state"
import {
  fakeFetch,
  withTestKey,
} from "../../../../../services/onboarding/__tests__/helpers"
import {
  fakeReq,
  fakeRes,
  fakeScope,
  newModule,
  withOnboardingEnv,
} from "../../../../admin/pos-payments/__tests__/helpers"

describe("callback público (AC4: state antes da troca; sem vazar detalhe)", () => {
  let mod: ReturnType<typeof newModule>
  beforeEach(() => {
    mod = newModule()
    withTestKey()
    withOnboardingEnv()
    const { fetchImpl } = fakeFetch((call) => {
      if (call.url.endsWith("/oauth/token")) {
        return {
          body: { access_token: "AT", refresh_token: "RT", expires_in: 3600 },
        }
      }
      return { body: { id: 42, nickname: "loja" } }
    })
    globalThis.fetch = fetchImpl
  })

  it("error do adquirente → redirect result=error sem trocar code", async () => {
    const res = fakeRes()
    await callback(
      fakeReq({ acquirer: "mercadopago" }, fakeScope({ module: mod }), {
        query: { error: "access_denied", state: "x" },
      }),
      res as never
    )
    expect(res.redirected?.location).toContain("result=error")
    expect(mod.db.connections).toHaveLength(0)
  })

  it("state ausente/inválido → error; state válido troca code e conecta (ok)", async () => {
    const scope = fakeScope({ module: mod })
    const res = fakeRes()
    await callback(
      fakeReq({ acquirer: "mercadopago" }, scope, { query: { code: "c" } }),
      res as never
    )
    expect(res.redirected?.location).toContain("result=error")

    const state = await issueState(mod.svc as never, "mercadopago", "admin-1")
    const ok = fakeRes()
    await callback(
      fakeReq({ acquirer: "mercadopago" }, scope, {
        query: { state, code: "code-1" },
      }),
      ok as never
    )
    expect(ok.redirected?.location).toContain("result=ok")
    expect(mod.db.connections[0]!.status).toBe("connected")
    expect(mod.db.connections[0]!.externalRefs).toMatchObject({ user_id: "42" })
    expect(mod.db.credentials).toHaveLength(1)
  })

  it("2ª callback com o MESMO state → error (single-use)", async () => {
    const scope = fakeScope({ module: mod })
    const state = await issueState(mod.svc as never, "mercadopago", "admin-1")
    await callback(
      fakeReq({ acquirer: "mercadopago" }, scope, {
        query: { state, code: "c1" },
      }),
      fakeRes() as never
    )
    const second = fakeRes()
    await callback(
      fakeReq({ acquirer: "mercadopago" }, scope, {
        query: { state, code: "c2" },
      }),
      second as never
    )
    expect(second.redirected?.location).toContain("result=error")
  })

  it("falha na troca (rede/adquirente) → result=error sem vazar detalhe", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "x" }), {
        status: 500,
      })) as typeof fetch
    const scope = fakeScope({ module: mod })
    const state = await issueState(mod.svc as never, "mercadopago", "admin-1")
    const res = fakeRes()
    await callback(
      fakeReq({ acquirer: "mercadopago" }, scope, {
        query: { state, code: "c" },
      }),
      res as never
    )
    expect(res.redirected?.location).toContain("result=error")
    expect(res.redirected?.location).not.toContain("500")
  })
})
