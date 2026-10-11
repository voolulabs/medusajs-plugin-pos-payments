import { describe, expect, it } from "vitest"
import {
  createStore,
  createPos,
  deletePos,
  listPos,
  searchStores,
} from "../stores"
import {
  exchangeCode,
  refreshOnboardingToken,
  validateOnboardingConnection,
} from "../onboarding"
import { OnboardingHttpClient, OnboardingHttpError } from "../onboarding-client"
import { OnboardingError } from "../../../services/onboarding/errors"
import { fakeFetch } from "../../../services/onboarding/__tests__/helpers"

const cfg = {
  clientId: "cid",
  clientSecret: "cs",
  redirectUri: "https://x.example.com/cb",
}

function httpFor(
  responder: (call: { method: string; url: string }) => {
    status?: number
    body?: unknown
  }
) {
  const f = fakeFetch((call) =>
    responder({ method: call.method, url: call.url })
  )
  return {
    calls: f.calls,
    http: new OnboardingHttpClient({ fetchImpl: f.fetchImpl }),
  }
}

describe("gaps de branches do onboarding/stores (cobertura)", () => {
  it("createStore com location/businessHours; search sem filtros; listPos com body-array", async () => {
    const { calls, http } = httpFor(() => ({ body: { results: [{ id: 1 }] } }))
    await createStore(http, "t", "7", {
      name: "L",
      externalId: "e1",
      location: { city_name: "Porto Alegre" },
      businessHours: { mon: [{ open: "09:00", close: "18:00" }] },
    })
    const body = JSON.parse(calls[0]!.rawBody!)
    expect(body.location).toBeTruthy()
    expect(body.business_hours).toBeTruthy()
    await searchStores(http, "t", "7")
    expect(calls[1]!.url.endsWith("/users/7/stores/search")).toBe(true)
    await deletePos(http, "t", "3")
    expect(calls[2]!.method).toBe("DELETE")
  })

  it("listPos aceita body-array puro; createPos com storeId numérico", async () => {
    const f = fakeFetch(() => ({ body: [{ id: 5 }] }))
    const http = new OnboardingHttpClient({ fetchImpl: f.fetchImpl })
    const pos = await listPos(http, "t", { externalId: "e" })
    expect(pos[0]!.id).toBe(5)
    const f2 = fakeFetch(() => ({ status: 201, body: { id: 6 } }))
    const http2 = new OnboardingHttpClient({ fetchImpl: f2.fetchImpl })
    const created = await createPos(
      http2,
      "t",
      { externalId: "s", storeId: "123" },
      "2b7f1e2a-1111-4222-8333-444455556666"
    )
    expect(created.id).toBe(6)
    expect(JSON.parse(f2.calls[0]!.rawBody!).store_id).toBe("123")
  })

  it("exchange: resposta sem refresh_token/expires_in devolve só access_token", async () => {
    const { http } = httpFor(() => ({ body: { access_token: "A" } }))
    const pair = await exchangeCode(http, cfg, "c")
    expect(pair.access_token).toBe("A")
    expect(pair.refresh_token).toBeUndefined()
    expect(pair.expires_at).toBeUndefined()
  })

  it("refresh: bad_request também vira reauthorize; validate: erro não-401 propaga cru", async () => {
    const { http } = httpFor((call) =>
      call.url.endsWith("/oauth/token")
        ? { status: 400, body: { error: "bad_request" } }
        : { status: 500, body: { error: "internal" } }
    )
    await expect(refreshOnboardingToken(http, cfg, "rt")).rejects.toMatchObject(
      {
        code: "reauthorize",
      }
    )
    await expect(
      validateOnboardingConnection(http, "t")
    ).rejects.toBeInstanceOf(OnboardingHttpError)
  })

  it("validate: id numérico sem nickname; client: corpo não-JSON em erro", async () => {
    const { http } = httpFor(() => ({ body: { id: 99 } }))
    const refs = await validateOnboardingConnection(http, "t")
    expect(refs).toEqual({ user_id: "99" })
    const f = fakeFetch(() => ({ status: 500, body: null }))
    const http2 = new OnboardingHttpClient({ fetchImpl: f.fetchImpl })
    await expect(http2.request("GET", "/users/me")).rejects.toBeInstanceOf(
      OnboardingHttpError
    )
  })

  it("client: json e form mutuamente exclusivos na serialização", async () => {
    const f = fakeFetch(() => ({ body: { ok: true } }))
    const http = new OnboardingHttpClient({ fetchImpl: f.fetchImpl })
    await http.request("POST", "/x", { json: { a: 1 } })
    expect(f.calls[0]!.rawBody).toBe('{"a":1}')
    await http.request("POST", "/y", { form: new URLSearchParams({ b: "2" }) })
    expect(f.calls[1]!.rawBody).toBe("b=2")
    await http.request("GET", "/z")
    expect(f.calls[2]!.rawBody).toBeNull()
  })

  it("exchange sem access_token lança OnboardingError (nunca segue vazio)", async () => {
    const { http } = httpFor(() => ({ body: { unexpected: true } }))
    await expect(exchangeCode(http, cfg, "c")).rejects.toBeInstanceOf(
      OnboardingError
    )
  })
})
