import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { GET as listStores, POST as createStoreRoute } from "../stores/route"
import { GET as listPos, POST as createPosRoute } from "../stores/pos/route"
import { GET as listRoute } from "../connections/route"
import { POST as startRoute } from "../connections/[acquirer]/start/route"
import { POST as testRoute } from "../connections/[acquirer]/test/route"
import { POST as selectRoute } from "../terminals/[id]/select/route"
import { GET as registersGet, POST as registersPost } from "../registers/route"
import { registersOf } from "../registers/route"
import { sendOnboardingError, merchantCredentials } from "../onboarding-context"
import { connectValidated } from "../../../../services/onboarding/connections"
import {
  getValidAccessToken,
  resetInflight,
} from "../../../../services/onboarding/refresh"
import { OnboardingError } from "../../../../services/onboarding/errors"
import {
  fakeFetch,
  withTestKey,
} from "../../../../services/onboarding/__tests__/helpers"
import {
  fakeReq,
  fakeRes,
  fakeScope,
  newModule,
  withOnboardingEnv,
} from "./helpers"
import { GET as callbackGet } from "../../../pos-payments/callback/[acquirer]/route"

describe("gaps de branches das rotas de onboarding", () => {
  let mod: ReturnType<typeof newModule>
  let scope: ReturnType<typeof fakeScope>
  let original: typeof fetch
  beforeEach(async () => {
    original = globalThis.fetch
    mod = newModule()
    withTestKey()
    withOnboardingEnv()
    scope = fakeScope({ module: mod })
    resetInflight()
  })
  afterEach(() => {
    globalThis.fetch = original
  })

  async function seedConnected(user = "5") {
    await connectValidated(mod.svc as never, {
      acquirer: "mercadopago",
      secret: {
        access_token: "t",
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      },
      actorId: null,
      from: "unconfigured",
      validate: async () => ({ user_id: user }),
    })
  }

  it("sendOnboardingError mapeia tipado vs 502; merchantCredentials fail-closed", async () => {
    const res = fakeRes()
    sendOnboardingError(
      res as never,
      new OnboardingError("invalid_credential", 400, "x")
    )
    expect(res.code).toBe(400)
    const res2 = fakeRes()
    sendOnboardingError(res2 as never, new Error("cru"))
    expect(res2.code).toBe(502)
    await expect(
      merchantCredentials(fakeReq({}, scope), {
        module: mod.svc as never,
        cfg: null,
        http: {} as never,
        actorId: null,
      })
    ).rejects.toMatchObject({
      code: "not_connected",
    })
  })

  it("refresh: conexão desconectada → not_connected; sem refresh_token → reauthorize", async () => {
    await connectValidated(mod.svc as never, {
      acquirer: "mercadopago",
      secret: {
        access_token: "t",
        expires_at: new Date(Date.now() - 1000).toISOString(),
      },
      actorId: null,
      from: "unconfigured",
      validate: async () => ({ user_id: "5" }),
    })
    const deps = {
      module: mod.svc,
      acquirer: "mercadopago",
      refresh: async () => ({ access_token: "n" }),
    }
    await expect(
      getValidAccessToken(deps as never, { forceRefresh: true })
    ).rejects.toMatchObject({
      code: "reauthorize",
    })
    const { fetchImpl } = fakeFetch(() => ({ body: {} }))
    original = globalThis.fetch
    globalThis.fetch = fetchImpl
    await expect(
      getValidAccessToken({
        module: mod.svc as never,
        acquirer: "fantasma",
        refresh: async () => ({ access_token: "x" }),
      })
    ).rejects.toMatchObject({ code: "not_connected" })
  })
})
