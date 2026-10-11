/* Fumaça T2.1/T3.1 — Orders API real (sandbox) com o adapter do plugin.
 * Sem hardware: terminal virtual + POST /v1/orders/{id}/events com janelas oficiais 10s/40s.
 * O token nunca é logado. */
// Caminho resolvido do checkout (o script vive em e2e/) — nada de caminho
// absoluto de maquina do autor.
const path = require("node:path")
const BASE = path.join(
  __dirname,
  "..",
  "..",
  "plugins",
  "pos-payments",
  ".medusa",
  "server",
  "src",
  "adapters",
  "mercadopago"
)
const { MercadoPagoAdapter } = require(path.join(BASE, "adapter.js"))

const token = process.env.MP_ACCESS_TOKEN
if (!token || !token.startsWith("APP_USR-")) {
  console.error("FAIL token: credencial de teste ausente ou com prefixo errado")
  process.exit(1)
}
// Guard T6: o fallback de terminal pode ser SBX — testMode explicito.
const adapter = new MercadoPagoAdapter({ accessToken: token, testMode: true })
const results = []
const log = (step, ok, detail) => {
  results.push(ok)
  console.log(
    (ok ? "PASS" : "FAIL") + " " + step + (detail ? " :: " + detail : "")
  )
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  // 1) terminais
  const page = await adapter.listTerminals({ limit: 10 })
  const terminal =
    (page.terminals[0] && page.terminals[0].id) || "NEWLAND_N950__SBX0000001"
  log(
    "terminais.list",
    page.terminals.length > 0,
    `total=${page.paging.total} usando=${terminal}`
  )

  // 2) criar cobrança (R$ 10,00)
  const ref = "smoke" + Date.now()
  const key = "pos-payments-mercadopago:" + ref + ":charge"
  const criada = await adapter.createCharge(
    {
      amountMinor: 1000,
      externalReference: ref,
      terminalId: terminal,
      expirationTime: "PT15M",
    },
    key
  )
  log(
    "charges.create",
    !!criada.chargeId,
    `charge=${criada.chargeId} state=${criada.view.state} raw=${criada.view.rawStatus}`
  )

  // 3) replay com a MESMA chave → mesma ordem
  const replay = await adapter.createCharge(
    {
      amountMinor: 1000,
      externalReference: ref,
      terminalId: terminal,
      expirationTime: "PT15M",
    },
    key
  )
  log(
    "idempotencia.replay",
    replay.chargeId === criada.chargeId,
    `mesma-ordem=${replay.chargeId === criada.chargeId}`
  )

  // 4) consultar (estado autoritativo)
  const vista = await adapter.getCharge(criada.chargeId)
  log(
    "charges.get",
    vista.rawStatus === "created",
    `raw=${vista.rawStatus} state=${vista.state}`
  )

  // 5) simular processado e pollar até o estado pago
  const sim = await fetch(
    "https://api.mercadopago.com/v1/orders/" + criada.chargeId + "/events",
    {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
      },
      body: JSON.stringify({ status: "processed" }),
    }
  )
  log("simulacao.processed", sim.status === 204, `http=${sim.status}`)
  let paga = null
  for (let i = 0; i < 8; i++) {
    await sleep(2500)
    paga = await adapter.getCharge(criada.chargeId)
    if (paga.rawStatus === "processed") break
  }
  log(
    "charges.poll.paid",
    paga && paga.state === "paid",
    paga
      ? `raw=${paga.rawStatus} state=${paga.state} payment=${paga.paymentId ?? "-"}`
      : "timeout"
  )

  // 6) refund TOTAL (caminho do dinheiro: minor -> decimal e volta)
  const estorno = await adapter.refundCharge(
    criada.chargeId,
    "pos-payments-mercadopago:" + ref + ":refund"
  )
  log(
    "charges.refund",
    estorno.state === "refunded",
    `raw=${estorno.rawStatus} state=${estorno.state}`
  )

  // 7) cancelar cobrança nova em `created`
  const ref2 = ref + "b"
  const segunda = await adapter.createCharge(
    {
      amountMinor: 500,
      externalReference: ref2,
      terminalId: terminal,
      expirationTime: "PT15M",
    },
    "pos-payments-mercadopago:" + ref2 + ":charge"
  )
  const cancelada = await adapter.cancelCharge(
    segunda.chargeId,
    "pos-payments-mercadopago:" + ref2 + ":cancel",
    { allowAtTerminal: true }
  )
  log(
    "charges.cancel",
    cancelada.state === "canceled",
    `raw=${cancelada.rawStatus} state=${cancelada.state}`
  )

  // 8) negativo: cancelar cobrança já processada deve falhar na adquirente
  let recusou = false
  try {
    await adapter.cancelCharge(
      criada.chargeId,
      "pos-payments-mercadopago:" + ref + ":cancel2",
      { allowAtTerminal: true }
    )
  } catch (e) {
    recusou = true
  }
  log("cancel.processed.recusado", recusou, "adquirente recusou como esperado")

  const pass = results.filter(Boolean).length
  console.log(`RESUMO: ${pass}/${results.length} PASS`)
  process.exit(pass === results.length ? 0 : 1)
}

main().catch((e) => {
  console.error("FAIL excecao :: " + String(e).slice(0, 300))
  process.exit(1)
})
