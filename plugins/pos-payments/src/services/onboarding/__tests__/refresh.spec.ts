import { beforeEach, describe, expect, it } from "vitest"
import { connectValidated } from "../connections"
import { OnboardingError } from "../errors"
import { getValidAccessToken, resetInflight } from "../refresh"
import { decryptSecret, keySetFromEnv } from "../../../utils/crypto-envelope"
import { fakeModule, withTestKey } from "./helpers"

interface RefreshDepsLike {
  module: never
  acquirer: string
  refresh: (rt: string) => Promise<{
    access_token: string
    refresh_token?: string
    expires_at?: string
  }>
}

function setup() {
  const mod = fakeModule()
  withTestKey()
  resetInflight()
  return mod
}

async function seedConnected(
  mod: ReturnType<typeof setup>,
  expiresInMs: number
) {
  await connectValidated(
    mod.svc as never,
    {
      acquirer: "mercadopago",
      secret: {
        access_token: "old",
        refresh_token: "rt-old",
        expires_at: new Date(Date.now() + expiresInMs).toISOString(),
      },
      actorId: "admin-1",
      from: "unconfigured",
      validate: async () => ({ user_id: "1" }),
    } as never
  )
}

type RefreshFn = (rt: string) => Promise<{
  access_token: string
  refresh_token?: string
  expires_at?: string
}>

function makeDeps(
  mod: ReturnType<typeof setup>,
  refresh: RefreshFn
): RefreshDepsLike {
  return {
    module: mod.svc,
    acquirer: "mercadopago",
    refresh,
  } as unknown as RefreshDepsLike
}

describe("refresh (AC5: single-flight, rotação atômica, invalid_grant)", () => {
  let mod: ReturnType<typeof setup>
  beforeEach(() => {
    mod = setup()
  })

  it("token válido não refresca", async () => {
    await seedConnected(mod, 60 * 60 * 1000)
    const deps = makeDeps(mod, async () => {
      throw new Error("não deveria refrescar")
    })
    await expect(getValidAccessToken(deps as never)).resolves.toBe("old")
  })

  it("perto do expiry refresca 1× mesmo com 2 chamadas concorrentes", async () => {
    await seedConnected(mod, 10 * 1000) // dentro da janela de renovação
    let refreshCalls = 0
    const deps2 = makeDeps(mod, async (rt: string) => {
      refreshCalls++
      expect(rt).toBe("rt-old")
      return {
        access_token: "new",
        refresh_token: "rt-new",
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      }
    })
    const [a, b] = await Promise.all([
      getValidAccessToken(deps2 as never),
      getValidAccessToken(deps2 as never),
    ])
    expect([a, b]).toEqual(["new", "new"])
    expect(refreshCalls).toBe(1)
  })

  it("rotação substitui o par atomicamente (uma linha) e audita reauthorized", async () => {
    await seedConnected(mod, 10 * 1000)
    const deps = {
      module: mod.svc,
      acquirer: "mercadopago",
      refresh: async () => ({
        access_token: "new",
        refresh_token: "rt-new",
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      }),
    } as unknown as RefreshDepsLike
    await getValidAccessToken(deps as never)
    expect(mod.db.credentials).toHaveLength(1)
    const persistido = JSON.parse(
      decryptSecret(
        String(mod.db.credentials[0]!.payload),
        keySetFromEnv(process.env)
      )
    )
    expect(persistido.access_token).toBe("new")
    expect(persistido.refresh_token).toBe("rt-new")
    expect(mod.db.audits.map((a) => a.event)).toContain(
      "connection.reauthorized"
    )
  })

  it("invalid_grant → action_required:reauthorize + audit; erro propagado", async () => {
    await seedConnected(mod, 10 * 1000)
    const deps = {
      module: mod.svc,
      acquirer: "mercadopago",
      refresh: async () => {
        throw new OnboardingError("reauthorize", 409, "refresh recusado")
      },
    } as unknown as RefreshDepsLike
    await expect(getValidAccessToken(deps as never)).rejects.toThrow(
      OnboardingError
    )
    const conn = mod.db.connections[0]!
    expect(conn.status).toBe("action_required")
    expect(conn.actionReason).toBe("reauthorize")
    expect(mod.db.audits.map((a) => a.event)).toContain(
      "connection.action_required"
    )
  })

  it("sem conexão ou sem credencial: not_connected/reauthorize fail-closed", async () => {
    const deps = {
      module: mod.svc,
      acquirer: "mercadopago",
      refresh: async () => ({ access_token: "x" }),
    } as unknown as RefreshDepsLike
    await expect(getValidAccessToken(deps as never)).rejects.toThrow(
      /inexistente/
    )
    await seedConnected(mod, 3600_000)
    mod.db.credentials = []
    await expect(getValidAccessToken(deps as never)).rejects.toThrow(
      OnboardingError
    )
  })
})
