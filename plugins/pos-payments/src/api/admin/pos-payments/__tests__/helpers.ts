/** Fakes de req/res/scope para os handlers de rota (sem servidor HTTP). */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PLUGIN_NAME } from "../../../../utils/plugin-options"
import {
  fakeModule,
  type FakeModule,
} from "../../../../services/onboarding/__tests__/helpers"

export function fakeScope(opts: {
  module: FakeModule
  onboardingOptions?: Record<string, unknown>
}) {
  const store = {
    id: "store_1",
    metadata: (opts.onboardingOptions?.__metadata ?? {}) as Record<
      string,
      unknown
    >,
  }
  const storeModule = {
    listStores: async () => [store],
    updateStores: async (_id: string, data: Record<string, unknown>) => {
      store.metadata = (data.metadata ?? {}) as Record<string, unknown>
    },
  }
  const configModule = {
    plugins: [
      {
        resolve: PLUGIN_NAME,
        options: {
          onboarding: {
            mercadopago: {
              clientId: "cid",
              clientSecret: "csecret",
              redirectUri:
                "https://pos.example.com/pos-payments/callback/mercadopago",
            },
          },
        },
      },
    ],
  }
  const registry: Record<string, unknown> = {
    posPayments: opts.module.svc,
    store: storeModule,
    [ContainerRegistrationKeys.CONFIG_MODULE]: configModule,
  }
  return {
    resolve: (name: string) => registry[name],
    __store: store,
    __storeModule: storeModule,
  }
}

export function fakeRes() {
  const out = {
    code: 200,
    body: undefined as unknown,
    redirected: null as null | { code: number; location: string },
    status(c: number) {
      out.code = c
      return out
    },
    json(b: unknown) {
      out.body = b
      return out
    },
    redirect(code: number, location: string) {
      out.redirected = { code, location }
      return out
    },
  }
  return out
}

export function fakeReq(
  params: Record<string, string>,
  scope: unknown,
  extra: Record<string, unknown> = {}
) {
  return {
    params,
    scope,
    auth_context: { actor_id: "admin-1" },
    ...extra,
  } as never
}

export function newModule(): FakeModule {
  return fakeModule()
}

export function withOnboardingEnv(): void {
  process.env.POS_PAYMENTS_MASTER_KEY = "c".repeat(64)
  process.env.POS_PAYMENTS_MP_CLIENT_ID = "cid"
  process.env.POS_PAYMENTS_MP_CLIENT_SECRET = "csecret"
  process.env.POS_PAYMENTS_MP_REDIRECT_URI =
    "https://pos.example.com/pos-payments/callback/mercadopago"
}
