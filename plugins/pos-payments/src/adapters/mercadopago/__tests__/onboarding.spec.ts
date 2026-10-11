import { describe, expect, it } from "vitest"
import {
  authorizeUrl,
  exchangeCode,
  refreshOnboardingToken,
  validateOnboardingConnection,
} from "../onboarding"
import { OnboardingError } from "../../../services/onboarding/errors"
import { OnboardingHttpClient, OnboardingHttpError } from "../onboarding-client"
import { fakeFetch } from "../../../services/onboarding/__tests__/helpers"

const cfg = {
  clientId: "cid",
  clientSecret: "csecret",
  redirectUri: "https://pos.example.com/pos-payments/callback/mercadopago",
}

describe("oauth mp (AC4: urlencoded, plataforma só no backend)", () => {
  it("authorizeUrl com client_id/response_type/redirect_uri/state", () => {
    const url = new URL(authorizeUrl(cfg, "st-123"))
    expect(url.origin + url.pathname).toBe(
      "https://auth.mercadopago.com/authorization"
    )
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.searchParams.get("client_id")).toBe("cid")
    expect(url.searchParams.get("state")).toBe("st-123")
    expect(url.searchParams.get("redirect_uri")).toBe(cfg.redirectUri)
  })

  it("exchangeCode manda form-urlencoded com credenciais de plataforma", async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({
      body: {
        access_token: "AT",
        refresh_token: "RT",
        expires_in: 180 * 24 * 3600,
      },
    }))
    const http = new OnboardingHttpClient({ fetchImpl })
    const pair = await exchangeCode(http, cfg, "code-1")
    const call = calls[0]!
    expect(call.method).toBe("POST")
    expect(call.url).toBe("https://api.mercadopago.com/oauth/token")
    expect(call.headers["content-type"]).toContain(
      "application/x-www-form-urlencoded"
    )
    const form = new URLSearchParams(call.rawBody!)
    expect(form.get("grant_type")).toBe("authorization_code")
    expect(form.get("code")).toBe("code-1")
    expect(form.get("client_secret")).toBe("csecret")
    expect(form.get("test_token")).toBeNull()
    expect(pair.access_token).toBe("AT")
    expect(pair.refresh_token).toBe("RT")
    expect(pair.expires_at).toBeTruthy()
  })

  it("testToken=true acrescenta test_token (sandbox)", async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({
      body: { access_token: "T" },
    }))
    const http = new OnboardingHttpClient({ fetchImpl })
    await exchangeCode(http, { ...cfg, testToken: true }, "code")
    expect(new URLSearchParams(calls[0]!.rawBody!).get("test_token")).toBe(
      "true"
    )
  })

  it("refresh com invalid_grant (400) → OnboardingError reauthorize (AC5)", async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 400,
      body: { error: "invalid_grant", message: "nope" },
    }))
    const http = new OnboardingHttpClient({ fetchImpl })
    await expect(refreshOnboardingToken(http, cfg, "rt")).rejects.toMatchObject(
      {
        code: "reauthorize",
      }
    )
  })

  it("erro 5xx de rede NÃO vira reauthorize (degrada, não força reconexão)", async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 502,
      body: { error: "internal" },
    }))
    const http = new OnboardingHttpClient({ fetchImpl })
    await expect(
      refreshOnboardingToken(http, cfg, "rt")
    ).rejects.toBeInstanceOf(OnboardingHttpError)
  })

  it("validateOnboardingConnection: 401 → invalid_credential 400; ok → user_id", async () => {
    const { calls, fetchImpl } = fakeFetch((call) =>
      call.headers.authorization === "Bearer tok"
        ? { body: { id: 42, nickname: "loja" } }
        : { status: 401, body: { error: "unauthorized" } }
    )
    const http = new OnboardingHttpClient({ fetchImpl })
    await expect(
      validateOnboardingConnection(http, "bad")
    ).rejects.toMatchObject({
      code: "invalid_credential",
      status: 400,
    })
    const refs = await validateOnboardingConnection(http, "tok")
    expect(refs).toEqual({ user_id: "42", nickname: "loja" })
    expect(calls[0]!.url).toBe("https://api.mercadopago.com/users/me")
  })

  it("resposta de token sem access_token → erro tipado (nunca segue vazio)", async () => {
    const { fetchImpl } = fakeFetch(() => ({ body: { error: "x" } }))
    const http = new OnboardingHttpClient({ fetchImpl })
    await expect(exchangeCode(http, cfg, "c")).rejects.toBeInstanceOf(
      OnboardingError
    )
  })
})
