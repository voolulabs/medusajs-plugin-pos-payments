/* Fumaça L2 completa — matriz oficial de simulação do MP Point (Orders API).
 * Fonte: developers.mercadopago.com/pt/docs/mp-point/integration-test
 * Cenários: processed (baseline: create + replay idempotente + get), failed,
 * canceled, expired, refunded (sobre ordem processed nova) e action_required
 * (por último — a ordem fica presa no simulador compartilhado até expirar).
 * Passos de device (listTerminals/cancel via endpoint) são informativos: a
 * migração L2->L4 foi decidida — device virtual SBX0000001 não tem dono.
 * O token nunca é logado. */
// Caminho resolvido do checkout (o script vive em e2e/) — nada de caminho
// absoluto de maquina do autor.
const path = require("node:path")
const BASE = path.join(
  __dirname,
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
// Prefixos aceitos = o que o template documenta (APP_USR- produção, TEST-
// sandbox) — o contrato real do provider é só token não-vazio via Bearer.
if (!token || !/^(APP_USR-|TEST-)/.test(token)) {
  console.error(
    "FAIL token: credencial ausente ou com prefixo inesperado (aceitos: APP_USR-, TEST-)"
  )
  process.exit(1)
}
if (process.env.MP_POINT_TEST_MODE !== "true") {
  console.error("FAIL guard: MP_POINT_TEST_MODE=true ausente (T6 fail-closed)")
  process.exit(1)
}

const TERMINAL = "NEWLAND_N950__SBX0000001"
// Guard T6: testMode é opção do construtor (default false = produção).
const adapter = new MercadoPagoAdapter({ accessToken: token, testMode: true })
const results = []
const log = (step, ok, detail) => {
  results.push({ step, ok })
  console.log(
    (ok ? "PASS" : "FAIL") + " " + step + (detail ? " :: " + detail : "")
  )
}
const info = (step, detail) =>
  console.log("INFO " + step + (detail ? " :: " + detail : ""))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function simulate(chargeId, body) {
  const r = await fetch(
    "https://api.mercadopago.com/v1/orders/" + chargeId + "/events",
    {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      // Mesmo orcamento do client do plugin (15s) — o fetch cru do Node pode
      // ficar ate 300s esperando headers sem isso.
      signal: AbortSignal.timeout(15000),
    }
  )
  return r.status
}

async function pollAte(chargeId, estados, tentativas) {
  let vista = null
  for (let i = 0; i < tentativas; i++) {
    await sleep(5000)
    vista = await adapter.getCharge(chargeId)
    if (estados.includes(vista.state)) return vista
  }
  return vista
}

async function criarOrdem(ref, amountMinor) {
  const corpo = {
    amountMinor,
    externalReference: ref,
    terminalId: TERMINAL,
    expirationTime: "PT15M",
  }
  const chave = "pos-payments-mercadopago:" + ref + ":charge"
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      return await adapter.createCharge(corpo, chave)
    } catch (e) {
      const msg = String(e && e.message ? e.message : e)
      const fila = /already_queued_order_on_terminal|409/i.test(msg)
      if (fila && tentativa < 3) {
        info(
          "create.retry",
          "fila do simulador compartilhado ocupada; aguardando 15s (" +
            tentativa +
            "/3)"
        )
        await sleep(15000)
        continue
      }
      throw e
    }
  }
}

async function main() {
  // 0) terminais — informativo (device virtual sem dono: total=0 é o esperado; passo L4)
  const page = await adapter.listTerminals({ limit: 10 })
  info(
    "terminais.list",
    "total=" + page.paging.total + " (esperado 0 sem vínculo — passo L4)"
  )

  // 1) processed — baseline com replay idempotente e get
  const ref = "l2-" + Date.now()
  const criada = await criarOrdem(ref, 1000)
  log(
    "processed.create",
    !!criada.chargeId,
    "charge=" +
      criada.chargeId +
      " state=" +
      criada.view.state +
      " raw=" +
      criada.view.rawStatus
  )
  const replay = await criarOrdem(ref, 1000)
  log(
    "idempotencia.replay",
    replay.chargeId === criada.chargeId,
    "mesma-ordem=" + (replay.chargeId === criada.chargeId)
  )
  const vista = await adapter.getCharge(criada.chargeId)
  log(
    "processed.get.created",
    vista.rawStatus === "created",
    "raw=" + vista.rawStatus + " state=" + vista.state
  )
  const s1 = await simulate(criada.chargeId, { status: "processed" })
  log("processed.simulate", s1 === 204, "http=" + s1)
  const paga = await pollAte(criada.chargeId, ["paid"], 14)
  log(
    "processed.poll.paid",
    paga && paga.state === "paid",
    paga
      ? "raw=" +
          paga.rawStatus +
          " state=" +
          paga.state +
          " payment=" +
          (paga.paymentId ?? "-")
      : "timeout"
  )

  // 2) failed
  const ordemF = await criarOrdem(ref + "-failed", 1000)
  const sF = await simulate(ordemF.chargeId, { status: "failed" })
  log("failed.simulate", sF === 204, "http=" + sF)
  const falha = await pollAte(ordemF.chargeId, ["failed"], 14)
  log(
    "failed.poll",
    falha && falha.state === "failed",
    falha
      ? "raw=" +
          falha.rawStatus +
          " reason=" +
          String(falha.reason || "-").slice(0, 120)
      : "timeout"
  )

  // 3) canceled — simulado (cancel via endpoint exige vínculo: L4)
  const ordemC = await criarOrdem(ref + "-canceled", 1000)
  const sC = await simulate(ordemC.chargeId, { status: "canceled" })
  log("canceled.simulate", sC === 204, "http=" + sC)
  const cancelada = await pollAte(ordemC.chargeId, ["canceled"], 14)
  log(
    "canceled.poll",
    cancelada && cancelada.state === "canceled",
    cancelada ? "raw=" + cancelada.rawStatus : "timeout"
  )

  // 4) expired
  const ordemE = await criarOrdem(ref + "-expired", 1000)
  const sE = await simulate(ordemE.chargeId, { status: "expired" })
  log("expired.simulate", sE === 204, "http=" + sE)
  const expirada = await pollAte(ordemE.chargeId, ["expired"], 14)
  log(
    "expired.poll",
    expirada && expirada.state === "expired",
    expirada ? "raw=" + expirada.rawStatus : "timeout"
  )

  // 5) refunded — exige ordem processed nova
  const ordemR = await criarOrdem(ref + "-refunded", 1000)
  const sR = await simulate(ordemR.chargeId, { status: "processed" })
  log("refunded.setup.processed", sR === 204, "http=" + sR)
  const pagaR = await pollAte(ordemR.chargeId, ["paid"], 14)
  log(
    "refunded.setup.paid",
    pagaR && pagaR.state === "paid",
    pagaR ? "raw=" + pagaR.rawStatus : "timeout"
  )
  const sR2 = await simulate(ordemR.chargeId, { status: "refunded" })
  log("refunded.simulate", sR2 === 204, "http=" + sR2)
  const devolvida = await pollAte(ordemR.chargeId, ["refunded"], 14)
  log(
    "refunded.poll",
    devolvida && devolvida.state === "refunded",
    devolvida ? "raw=" + devolvida.rawStatus : "timeout"
  )

  // 6) action_required — até 40s oficialmente; janela generosa; roda por último
  const ordemA = await criarOrdem(ref + "-action", 1000)
  const sA = await simulate(ordemA.chargeId, { status: "action_required" })
  log("action_required.simulate", sA === 204, "http=" + sA)
  const acao = await pollAte(ordemA.chargeId, ["action_required"], 20)
  log(
    "action_required.poll",
    acao && acao.state === "action_required",
    acao
      ? "raw=" +
          acao.rawStatus +
          " reason=" +
          String(acao.reason || "-").slice(0, 120)
      : "timeout"
  )

  const pass = results.filter((r) => r.ok).length
  console.log("RESUMO: " + pass + "/" + results.length + " PASS")
  process.exit(pass === results.length ? 0 : 1)
}

main().catch((e) => {
  console.error(
    "FAIL excecao :: " + String(e && e.message ? e.message : e).slice(0, 300)
  )
  process.exit(1)
})
