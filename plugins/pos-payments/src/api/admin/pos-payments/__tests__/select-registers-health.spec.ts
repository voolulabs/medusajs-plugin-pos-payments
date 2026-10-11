import { beforeEach, describe, expect, it } from "vitest"
import { POST as selectRoute } from "../terminals/[id]/select/route"
import { GET as registersGet, POST as registersPost } from "../registers/route"
import { GET as healthRoute } from "../health/route"
import {
  fakeReq,
  fakeRes,
  fakeScope,
  newModule,
  withOnboardingEnv,
} from "./helpers"
import { withTestKey } from "../../../../services/onboarding/__tests__/helpers"

const UUID = "11111111-1111-4111-8111-111111111111"

describe("select/registers/health (AC9/AC10)", () => {
  let mod: ReturnType<typeof newModule>
  beforeEach(() => {
    mod = newModule()
    withTestKey()
    withOnboardingEnv()
  })

  it("select sem registerId grava default global; com registerId grava binding depth-1", async () => {
    const scope = scopeFor()
    const res = fakeRes()
    await selectRoute(
      fakeReq({ id: "PAX_A920__SBX0000001" }, scope, { body: {} }),
      res as never
    )
    expect(res.code).toBe(200)
    let meta = (
      scope as unknown as { __store: { metadata: Record<string, unknown> } }
    ).__store.metadata
    expect(
      (
        (meta.pos as Record<string, unknown>).payments as Record<
          string,
          unknown
        >
      ).terminal
    ).toEqual({ acquirer: "mercadopago", id: "PAX_A920__SBX0000001" })

    await selectRoute(
      fakeReq({ id: "PAX_A920__SBX0000002" }, scope, {
        body: { registerId: UUID },
      }),
      fakeRes() as never
    )
    meta = (
      scope as unknown as { __store: { metadata: Record<string, unknown> } }
    ).__store.metadata
    const payments = (meta.pos as Record<string, unknown>).payments as Record<
      string,
      unknown
    >
    expect(
      (
        (payments.registers as Record<string, unknown>)[UUID] as Record<
          string,
          unknown
        >
      ).terminal
    ).toEqual({ acquirer: "mercadopago", id: "PAX_A920__SBX0000002" })
    // default global preservado (merge, não clobber)
    expect(payments.terminal).toBeTruthy()
    expect(mod.db.audits.map((a) => a.event)).toContain("terminal.selected")
  })

  it("registers POST idempotente + GET reflete o mapa", async () => {
    const scope = scopeFor()
    const body = { registerId: UUID, label: "Caixa 1" }
    await registersPost(fakeReq({}, scope, { body }), fakeRes() as never)
    await registersPost(fakeReq({}, scope, { body }), fakeRes() as never)
    const res = fakeRes()
    await registersGet(fakeReq({}, scope), res as never)
    const registers = (res.body as { registers: Record<string, unknown> })
      .registers
    expect(Object.keys(registers)).toEqual([UUID])
    expect((registers[UUID] as Record<string, unknown>).label).toBe("Caixa 1")
    expect(
      mod.db.audits.map((a) => a.event).filter((e) => e === "register.bound")
    ).toHaveLength(2)
  })

  it("health estendido com conexões e SEM segredos na resposta", async () => {
    mod.db.connections.push({
      acquirer: "mercadopago",
      status: "connected",
      actionReason: null,
      externalRefs: { user_id: "1" },
      expiresAt: null,
      lastValidatedAt: null,
    })
    const scope = fakeScope({ module: mod })
    const res = fakeRes()
    await healthRoute(fakeReq({}, scope), res as never)
    expect((res.body as { status: string }).status).toBe("ok")
    const conns = (res.body as { connections: Array<Record<string, unknown>> })
      .connections
    expect(conns).toHaveLength(1)
    expect(conns[0]).not.toHaveProperty("credential")
    expect(JSON.stringify(res.body)).not.toContain("access_token")
  })

  function scopeFor() {
    return fakeScope({ module: mod })
  }
})
