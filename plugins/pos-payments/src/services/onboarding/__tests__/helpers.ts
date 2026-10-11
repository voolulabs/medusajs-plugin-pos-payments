/** Módulo fake em memória (superfície MedusaService usada pelos serviços de
 * onboarding) + fetch fake com captura de chamadas. Formas do core: create
 * recebe ARRAY, update recebe ARRAY de {id, ...}, delete aceita id único. */
export function fakeModule() {
  const db = {
    connections: [] as Array<Record<string, unknown>>,
    credentials: [] as Array<Record<string, unknown>>,
    states: [] as Array<Record<string, unknown>>,
    audits: [] as Array<Record<string, unknown>>,
  }
  let seq = 0
  const id = (p: string) => `${p}${++seq}`
  const match = (row: Record<string, unknown>, f: Record<string, unknown>) =>
    Object.entries(f).every(([k, v]) => row[k] === v)
  const svc = {
    createPosPaymentsConnections: async (
      data: Array<Record<string, unknown>>
    ) => {
      const rows = data.map((d) => ({ id: id("c"), ...d }))
      db.connections.push(...rows)
      return rows
    },
    listPosPaymentsConnections: async (f: Record<string, unknown>) =>
      db.connections.filter((r) => match(r, f)),
    updatePosPaymentsConnections: async (
      data: Array<Record<string, unknown>>
    ) => {
      for (const d of data)
        Object.assign(
          db.connections.find((r) => r.id === d.id)!,
          d
        )
    },
    createPosPaymentsCredentials: async (
      data: Array<Record<string, unknown>>
    ) => void db.credentials.push(...data.map((d) => ({ id: id("k"), ...d }))),
    listPosPaymentsCredentials: async (f: Record<string, unknown>) =>
      db.credentials.filter((r) => match(r, f)),
    updatePosPaymentsCredentials: async (
      data: Array<Record<string, unknown>>
    ) => {
      for (const d of data)
        Object.assign(
          db.credentials.find((r) => r.id === d.id)!,
          d
        )
    },
    deletePosPaymentsCredentials: async (rid: string) => {
      db.credentials = db.credentials.filter((r) => r.id !== rid)
    },
    createPosPaymentsOauthStates: async (
      data: Array<Record<string, unknown>>
    ) => void db.states.push(...data.map((d) => ({ id: id("s"), ...d }))),
    listPosPaymentsOauthStates: async (f: Record<string, unknown>) =>
      db.states.filter((r) => match(r, f)),
    updatePosPaymentsOauthStates: async (
      data: Array<Record<string, unknown>>
    ) => {
      for (const d of data)
        Object.assign(
          db.states.find((r) => r.id === d.id)!,
          d
        )
    },
    createPosPaymentsAuditEvents: async (
      data: Array<Record<string, unknown>>
    ) => void db.audits.push(...data.map((d) => ({ id: id("a"), ...d }))),
  }
  return { svc, db }
}

export type FakeModule = ReturnType<typeof fakeModule>

type CapturedCall = {
  method: string
  url: string
  headers: Record<string, string>
  rawBody: string | null
}

export function fakeFetch(
  responder: (call: CapturedCall) => { status?: number; body?: unknown }
): { calls: CapturedCall[]; fetchImpl: typeof fetch } {
  const calls: CapturedCall[] = []
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(
        ([k, v]) => [k.toLowerCase(), v]
      )
    )
    const call: CapturedCall = {
      method: (init?.method ?? "GET").toUpperCase(),
      url: String(url),
      headers,
      rawBody: typeof init?.body === "string" ? init.body : null,
    }
    calls.push(call)
    const r = responder(call)
    return new Response(JSON.stringify(r.body ?? {}), {
      status: r.status ?? 200,
      headers: { "Content-Type": "application/json" },
    })
  }) as typeof fetch
  return { calls, fetchImpl }
}

const TEST_KEY = "c".repeat(64)

export function withTestKey(): void {
  process.env.POS_PAYMENTS_MASTER_KEY = TEST_KEY
  delete process.env.POS_PAYMENTS_MASTER_KEY_PREVIOUS
}
