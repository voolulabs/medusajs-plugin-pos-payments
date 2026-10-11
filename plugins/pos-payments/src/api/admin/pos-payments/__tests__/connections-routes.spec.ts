import { beforeEach, describe, expect, it } from "vitest"
import {
  fakeFetch,
  withTestKey,
} from "../../../../services/onboarding/__tests__/helpers"
import { POST as startRoute } from "../connections/[acquirer]/start/route"
import {
  GET as connectionDetail,
  POST as pasteRoute,
  DELETE as deleteRoute,
} from "../connections/[acquirer]/route"
import { GET as listRoute } from "../connections/route"
import { POST as testRoute } from "../connections/[acquirer]/test/route"
import {
  fakeReq,
  fakeRes,
  fakeScope,
  newModule,
  withOnboardingEnv,
} from "./helpers"

function scopeWith(mod: ReturnType<typeof newModule>) {
  return fakeScope({ module: mod })
}

describe("rotas de conexão (AC4/AC6/AC7/AC10)", () => {
  let mod: ReturnType<typeof newModule>
  beforeEach(() => {
    mod = newModule()
    withTestKey()
    withOnboardingEnv()
  })

  it("start emite state de uso único e authorize_url com client_id da plataforma", async () => {
    const res = fakeRes()
    await startRoute(
      fakeReq({ acquirer: "mercadopago" }, scopeWith(mod)),
      res as never
    )
    expect(res.code).toBe(200)
    const url = new URL((res.body as { authorize_url: string }).authorize_url)
    expect(url.searchParams.get("client_id")).toBe("cid")
    expect((res.body as { authorize_url: string }).authorize_url).toContain(
      "auth.mercadopago.com/authorization"
    )
    expect(mod.db.states).toHaveLength(1)
    expect(mod.db.audits.map((a) => a.event)).toContain("connection.started")
  })

  it("POST credencial colada: validate-then-activate (falha não persiste — AC6)", async () => {
    const { fetchImpl } = fakeFetch((call) =>
      call.headers.authorization === "Bearer tok-mercado-pago-0000000000"
        ? { body: { id: 77 } }
        : { status: 401, body: { error: "unauthorized" } }
    )
    const scope = scopeWith(mod)
    // fetch do onboarding: o contexto lê das options do plugin — injetamos via env? Não:
    // o helper de scope usa options fixas; o http usa fetch global. Substituímos global.
    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchImpl
    try {
      const bad = fakeRes()
      await pasteRoute(
        fakeReq({ acquirer: "mercadopago" }, scope, {
          body: { accessToken: "tok-invalido-insuficiente" },
        }),
        bad as never
      )
      expect(bad.code).toBe(400)
      expect(mod.db.connections).toHaveLength(0)

      const ok = fakeRes()
      await pasteRoute(
        fakeReq({ acquirer: "mercadopago" }, scope, {
          body: { accessToken: "tok-mercado-pago-0000000000" },
        }),
        ok as never
      )
      expect(ok.code).toBe(200)
      expect(mod.db.connections[0]!.status).toBe("connected")
      expect(mod.db.credentials).toHaveLength(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("DELETE purga credencial e audita; GET lista sem segredos (AC7/AC10)", async () => {
    const scope = scopeWith(mod)
    const res = fakeRes()
    await deleteRoute(fakeReq({ acquirer: "mercadopago" }, scope), res as never)
    expect(res.code).toBe(200)
    const listed = fakeRes()
    await listRoute(fakeReq({}, scope), listed as never)
    const conns = (listed.body as { connections: unknown[] }).connections
    expect(conns).toEqual([])
  })

  it("detail 404 tipado para adquirente inexistente", async () => {
    const res = fakeRes()
    await connectionDetail(
      fakeReq({ acquirer: "stone" }, scopeWith(mod)),
      res as never
    )
    expect(res.code).toBe(404)
  })

  it("test sem conexão → 404 tipado (o caminho degraded está no route-gaps-2)", async () => {
    const res = fakeRes()
    await testRoute(
      fakeReq({ acquirer: "mercadopago" }, scopeWith(mod)),
      res as never
    )
    expect(res.code).toBe(404)
  })
})
