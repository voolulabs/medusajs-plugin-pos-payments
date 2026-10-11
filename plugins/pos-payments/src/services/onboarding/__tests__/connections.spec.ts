import { beforeEach, describe, expect, it } from "vitest"
import {
  connectValidated,
  disconnectConnection,
  findConnection,
} from "../connections"
import { OnboardingError } from "../errors"
import { fakeModule, withTestKey } from "./helpers"

const validateOk = async () => ({ user_id: "12345", nickname: "lojista" })

describe("connections (AC6/AC7: validate-then-activate + purga)", () => {
  let mod: ReturnType<typeof fakeModule>
  beforeEach(() => {
    mod = fakeModule()
    withTestKey()
  })

  it("falha de validação NÃO persiste nada (AC6)", async () => {
    await expect(
      connectValidated(mod.svc as never, {
        acquirer: "mercadopago",
        secret: { access_token: "t" },
        actorId: "admin-1",
        from: "connecting",
        validate: async () => {
          throw new OnboardingError("invalid_credential", 400, "recusada")
        },
      })
    ).rejects.toThrow(OnboardingError)
    expect(mod.db.connections).toHaveLength(0)
    expect(mod.db.credentials).toHaveLength(0)
  })

  it("conexão validada persiste connected + refs + credencial cifrada + audit", async () => {
    await connectValidated(mod.svc as never, {
      acquirer: "mercadopago",
      secret: { access_token: "tk", refresh_token: "rt" },
      actorId: "admin-1",
      from: "connecting",
      validate: validateOk,
    })
    expect(mod.db.connections).toHaveLength(1)
    const conn = mod.db.connections[0]!
    expect(conn.status).toBe("connected")
    expect(conn.externalRefs).toMatchObject({ user_id: "12345" })
    expect(mod.db.credentials).toHaveLength(1)
    const cred = mod.db.credentials[0]!
    expect(String(cred.payload).startsWith("posp.v1.")).toBe(true)
    expect(String(cred.payload)).not.toContain("tk")
    expect(mod.db.audits.map((a) => a.event)).toContain("connection.connected")
  })

  it("findConnection devolve a conexão do adquirente; ausente = null", async () => {
    expect(await findConnection(mod.svc as never, "mercadopago")).toBeNull()
    await connectValidated(mod.svc as never, {
      acquirer: "mercadopago",
      secret: { access_token: "tk" },
      actorId: null,
      from: "unconfigured",
      validate: validateOk,
    })
    expect(
      (await findConnection(mod.svc as never, "mercadopago"))?.status
    ).toBe("connected")
  })

  it("desconectar purga credencial, marca disconnected e audita (AC7)", async () => {
    await connectValidated(mod.svc as never, {
      acquirer: "mercadopago",
      secret: { access_token: "tk" },
      actorId: "admin-1",
      from: "unconfigured",
      validate: validateOk,
    })
    await disconnectConnection(mod.svc as never, "mercadopago", "admin-2")
    expect(mod.db.credentials).toHaveLength(0)
    const conn = await findConnection(mod.svc as never, "mercadopago")
    expect(conn?.status).toBe("disconnected")
    const events = mod.db.audits.map((a) => a.event)
    expect(events).toContain("connection.disconnected")
  })

  it("desconectar sem conexão é no-op idempotente", async () => {
    await disconnectConnection(mod.svc as never, "mercadopago", "admin-1")
    expect(mod.db.audits).toHaveLength(0)
  })
})

describe("connectValidated: reconexão e corrida (branches da r2)", () => {
  it("reconexão sobre disconnected passa por unconfigured e conecta", async () => {
    const mod = fakeModule()
    withTestKey()
    await connectValidated(mod.svc as never, {
      acquirer: "mercadopago",
      secret: { access_token: "a" },
      actorId: null,
      from: "unconfigured",
      validate: async () => ({ user_id: "1" }),
    })
    await disconnectConnection(mod.svc as never, "mercadopago", null)
    await connectValidated(mod.svc as never, {
      acquirer: "mercadopago",
      secret: { access_token: "b" },
      actorId: null,
      from: "unconfigured",
      validate: async () => ({ user_id: "1" }),
    })
    expect(
      (await findConnection(mod.svc as never, "mercadopago"))?.status
    ).toBe("connected")
  })

  it("corrida de create (unique): re-lê a conexão existente e atualiza", async () => {
    const mod = fakeModule()
    withTestKey()
    mod.db.connections.push({
      id: "c-existing",
      acquirer: "mercadopago",
      status: "unconfigured",
      actionReason: null,
      externalRefs: {},
      expiresAt: null,
      lastValidatedAt: null,
    })
    const svc = mod.svc as unknown as Record<string, unknown>
    svc.createPosPaymentsConnections = async () => {
      throw new Error("duplicate key value violates unique constraint")
    }
    const conn = await connectValidated(svc as never, {
      acquirer: "mercadopago",
      secret: { access_token: "a" },
      actorId: null,
      from: "unconfigured",
      validate: async () => ({ user_id: "1" }),
    })
    expect(conn.id).toBe("c-existing")
    expect(conn.status).toBe("connected")
  })
})
