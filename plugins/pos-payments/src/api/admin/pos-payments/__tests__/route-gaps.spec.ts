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

  it("stores GET sem filtro devolve 200", async () => {
    const { fetchImpl } = fakeFetch(() => ({ body: { results: [] } }))
    original = globalThis.fetch
    globalThis.fetch = fetchImpl
    await seedConnected()
    const listed = fakeRes()
    await listStores(fakeReq({}, scope, { query: {} }), listed as never)
    expect(listed.code).toBe(200)
  })

  it("stores POST com location/businessHours aceita; corpo inválido → 400", async () => {
    const { fetchImpl } = fakeFetch(() => ({ body: { results: [] } }))
    original = globalThis.fetch
    globalThis.fetch = fetchImpl
    await seedConnected()
    const created = fakeRes()
    await createStoreRoute(
      fakeReq({}, scope, {
        body: {
          name: "L",
          externalId: "u1",
          location: { city_name: "x" },
          businessHours: { mon: [] },
        },
      }),
      created as never
    )
    expect(created.code).toBe(201)
    const invalid = fakeRes()
    await createStoreRoute(
      fakeReq({}, scope, { body: { name: "", externalId: "bad!" } }),
      invalid as never
    )
    expect(invalid.code).toBe(400)
  })
})
