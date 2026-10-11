import { ContainerRegistrationKeys } from "@medusajs/utils"
import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { vi, type Mock } from "vitest"
import { PLUGIN_NAME } from "../../../../utils/plugin-options"

export const TERMINAL = "NEWLAND_N950__S1"

export const VALID_BODY = {
  amountMinor: 1999,
  externalReference: "ps_01ABC",
  terminalId: TERMINAL,
}

/** Ordem no contrato oficial, com valor e terminal batendo com VALID_BODY. */
export const ORDER_OK = {
  id: "ORD-1",
  status: "created",
  type: "point",
  external_reference: VALID_BODY.externalReference,
  config: { point: { terminal_id: TERMINAL } },
  transactions: {
    payments: [{ id: "PAY-1", amount: "19.99", status: "at_terminal" }],
  },
}

type QueuedResponse = { status: number; body: unknown }
export type FetchCall = { url: string; init: RequestInit }

/** Fetch fake do seam: grava as chamadas e responde da fila (default = ordem ok). */
function makeFetch(queue: QueuedResponse[]): {
  fetchImpl: Mock
  calls: FetchCall[]
} {
  const calls: FetchCall[] = []
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const next =
      queue.length > 0 ? queue.shift()! : { status: 200, body: ORDER_OK }
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "Content-Type": "application/json" },
    })
  })
  return { fetchImpl, calls }
}

type RequestOpts = {
  queue?: QueuedResponse[]
  /** null = bloco posTerminal ausente (rotas respondem NOT_ALLOWED). */
  plugin?: {
    acquirer?: string
    accessToken?: string
    mpPointTestMode?: boolean
    fetchImpl?: typeof fetch
  } | null
  body?: unknown
  params?: Record<string, string>
  query?: Record<string, unknown>
}

/** Request fake com scope que resolve o configModule (padrão plugin-options.spec). */
export function makeReq(opts: RequestOpts = {}): {
  req: AuthenticatedMedusaRequest
  calls: FetchCall[]
  loggerWarn: Mock
} {
  const { fetchImpl, calls } = makeFetch(opts.queue ?? [])
  const loggerWarn = vi.fn()
  const pluginOptions =
    opts.plugin === null
      ? {}
      : {
          posTerminal: {
            acquirer: "mercadopago",
            accessToken: "test-token-fixture",
            fetchImpl,
            ...(opts.plugin ?? {}),
          },
        }
  const configModule = {
    plugins: [{ resolve: PLUGIN_NAME, options: pluginOptions }],
  }
  const req = {
    scope: {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.CONFIG_MODULE) return configModule
        if (key === ContainerRegistrationKeys.LOGGER)
          return { warn: loggerWarn, info: vi.fn(), error: vi.fn() }
        return undefined
      },
    },
    body: opts.body,
    params: opts.params ?? {},
    query: opts.query ?? {},
  }
  return {
    req: req as unknown as AuthenticatedMedusaRequest,
    calls,
    loggerWarn,
  }
}

export function makeRes(): MedusaResponse {
  const res: Record<string, unknown> = {}
  res.status = vi.fn(() => res)
  res.json = vi.fn(() => res)
  return res as unknown as MedusaResponse
}

export const headerOf = (init: RequestInit, name: string): string | undefined =>
  (init.headers as Record<string, string> | undefined)?.[name]
