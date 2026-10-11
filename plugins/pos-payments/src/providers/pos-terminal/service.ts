import { randomUUID } from "node:crypto"
import { AbstractPaymentProvider, MedusaError } from "@medusajs/framework/utils"
import type { Logger, WebhookActionResult } from "@medusajs/framework/types"
import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
} from "@medusajs/framework/types"
import {
  mergeSessionData,
  posTerminalSessionSchema,
  assertSafeSessionKeys,
} from "./schema"
import { resolveAdapter } from "../../adapters"
import type { PosPaymentsAdapter } from "../../adapters/types"
import { mpInitiate } from "./service-mp"
import { mpCancel, mpCapture } from "./service-mp-ops"
import { mpRefund } from "./service-mp-refund"
import { mpPoll } from "./mp-status"
import { mpWebhookAction } from "./service-webhook"
import { getPluginOptions } from "../../utils/plugin-options"
import { assertOptionsConsistency } from "../../utils/options-consistency"

type InjectedDependencies = {
  logger?: Logger
}

/**
 * Configuração por registro do provider (options no medusa-config). Fase 1 é
 * manual/terminal-presente: nada de credenciais. Adapters de adquirente entram
 * atrás desta opção nas fases seguintes.
 */
export type PosTerminalOptions = {
  /** Fase 1: "manual". Fases 2-3: "mercadopago" | "sumup" | "stone" | "cielo". */
  acquirer: string
  /** Aditivo (CONSTRAINTS 8): credencial da adquirerente via env do host — nunca literal. */
  accessToken?: string
  /** Secret de assinatura do webhook no DevPanel (T5) — obrigatório p/ mercadopago. */
  webhookSecret?: string
  /**
   * Guard MP_POINT_TEST_MODE (T6): aceita terminal de sandbox (serial SBX*).
   * Default false — produção. true NUNCA é silencioso (warn na construção do
   * provider) e não
   * isenta credenciais.
   */
  mpPointTestMode?: boolean
  /** Aditivo (CONSTRAINTS 5): seam de teste — fetch injetado (produção usa o global). */
  fetchImpl?: typeof fetch
}

type SessionData = Record<string, unknown>

/**
 * Mapa puro do `data` para o status (opcore: complexity.max-nesting). Erro de
 * leitura degrada para pending — getPaymentStatus nunca lança.
 */
function mapStatus(data: SessionData): GetPaymentStatusOutput {
  if (data.captured_at) return { status: "captured" }
  if (data.canceled_at) return { status: "canceled" }
  if (data.authorized_at) return { status: "authorized" }
  return { status: "pending" }
}

/**
 * Provider "terminal-presente" (ADR 0002 §9): a cobrança acontece
 * fisicamente na maquininha operada pelo caixa; o backend registra o estado.
 * Nenhuma chamada externa na Fase 1.
 *
 * Contrato do módulo payment (verificado no fonte
 * 2.21.1): todo método devolve o blob completo que deve sobreviver — devolver
 * `{}` clobberiza o estado. `authorizePayment` roda no markAsPaid;
 * `capturePayment` em já-capturado é protegido pelo módulo;
 * `getPaymentStatus` nunca lança; o `data` de initiatePayment é público.
 */
class PosTerminalProviderService extends AbstractPaymentProvider<PosTerminalOptions> {
  static override identifier = "pos-terminal"

  protected logger_: Logger
  protected options_: PosTerminalOptions
  protected adapter_: PosPaymentsAdapter | undefined

  static override validateOptions(options: PosTerminalOptions): void {
    // Fase 1: só "manual". A lista expande quando os adapters de adquirente
    // forem implementados (Fases 2-3) — adquirente desconhecida falha no boot.
    const SUPPORTED = ["manual", "mercadopago"]
    if (!options?.acquirer || !SUPPORTED.includes(options.acquirer)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `pos-terminal: options.acquirer deve ser um de [${SUPPORTED.join(", ")}] (recebido: ${options?.acquirer ?? "ausente"})`
      )
    }
    // CONSTRAINTS 4: falhar alto — sem credencial a adquirerente não sobe.
    if (options.acquirer === "mercadopago") {
      if (!options.accessToken) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "pos-terminal: acquirer mercadopago exige accessToken (env do host, nunca literal)"
        )
      }
      // T5: sem secret o webhook não é confiável — boot falha alto.
      if (!options.webhookSecret) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "pos-terminal: acquirer mercadopago exige webhookSecret (assinatura x-signature)"
        )
      }
    }
  }

  constructor(container: InjectedDependencies, options: PosTerminalOptions) {
    super(container, options)
    this.logger_ = (container.logger ?? console) as Logger
    this.options_ = options
    // A6 (W2.1): as rotas admin e o subscriber leem o bloco `posTerminal` das
    // options do plugin; o provider lê as options do registro do módulo payment.
    // Divergência na entrada NÃO-manual falha alto na PRIMEIRA RESOLUÇÃO do
    // provider (o loader do módulo é lazy — asFunction), citando só os NOMES
    // das chaves. Sem CONFIG_MODULE resolvível (embeds exóticos/testes):
    // degrada com info — a checagem é contra-drift, não barreira de segurança.
    let pluginPosTerminal: Parameters<typeof assertOptionsConsistency>[1]
    let configDisponivel = true
    try {
      pluginPosTerminal = getPluginOptions(container as never).posTerminal
    } catch (error) {
      configDisponivel = false
      // info (não warn): em produção o CONFIG_MODULE SEMPRE resolve — este
      // ramo só aparece em embeds exóticos/testes, onde o warn poluiria o
      // contrato "boot sem guard não loga warn". Detalhe do erro de resolução
      // awilix no log: nome de registro, nunca credencial.
      this.logger_.info(
        `pos-terminal: checagem de consistência de options pulada (CONFIG_MODULE não resolvível neste container: ${String(error).slice(0, 120)})`
      )
    }
    // Fora de qualquer catch: MedusaError do guard NUNCA é engolida pela
    // degradação do CONFIG_MODULE.
    if (configDisponivel) {
      assertOptionsConsistency(
        options,
        pluginPosTerminal,
        `pp_pos-terminal${options.acquirer ? `_${options.acquirer}` : ""}`
      )
    }
    // T6: nunca silencioso — teste sem hardware precisa gritar na construção
    // do provider.
    if (options.mpPointTestMode === true) {
      this.logger_.warn(
        "pos-terminal: MP_POINT_TEST_MODE ativo — terminais de sandbox (serial SBX*) aceitos; NUNCA usar em produção (mercado-pago.md §8)"
      )
    }
    // Construído UMA vez na resolução do provider (loader lazy asFunction —
    // adapter stateless sobre o cliente T1).
    this.adapter_ = resolveAdapter(options.acquirer, {
      accessToken: options.accessToken,
      testMode: options.mpPointTestMode === true,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    })
  }

  override async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    // No-op no modo manual — o módulo faz merge do data de entrada, que
    // é replayado pelo cliente: valida na fronteira antes.
    assertSafeSessionKeys(input.data as Record<string, unknown> | undefined)
    // O id do provider é opaco e público (nunca carregar dado sensível).
    if (this.adapter_) return mpInitiate(this.adapter_, input, this.logger_)
    return { id: randomUUID(), data: {} }
  }

  override async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    // O data persistido passa por aqui no markAsPaid — mesma fronteira do
    // updatePayment (o que chega já foi validado no create/update, mas o
    // provider não confia: valida de novo antes de persistir o blob).
    assertSafeSessionKeys(input.data as Record<string, unknown> | undefined)
    // Fase 1: a confirmação do caixa autenticado (admin JWT, via markAsPaid) É
    // a verificação do terminal-presente — rota de autorização é admin-only.
    // Fase 2 (hardening): vincular a register_session_id/handshake do caixa.
    return {
      data: { ...(input.data ?? {}), authorized_at: new Date().toISOString() },
      status: "authorized",
    }
  }

  override async capturePayment(
    input: CapturePaymentInput
  ): Promise<CapturePaymentOutput> {
    const data = (input.data ?? {}) as SessionData
    // Guarda local barata (review 2026-09-29): o core protege os fluxos
    // atuais, mas com adapters remotos (Fase 2) falhar aqui evita chamada
    // à adquirente antes do UNEXPECTED_STATE.
    if (data.canceled_at) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "pos-terminal: captura de cobrança cancelada"
      )
    }
    if (data.captured_at) return { data }
    if (this.adapter_) return mpCapture(this.adapter_, data, this.logger_)
    return { data: { ...data, captured_at: new Date().toISOString() } }
  }

  override async refundPayment(
    input: RefundPaymentInput
  ): Promise<RefundPaymentOutput> {
    const data = (input.data ?? {}) as SessionData
    if (data.canceled_at) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "pos-terminal: reembolso de cobrança cancelada"
      )
    }
    if (this.adapter_)
      return mpRefund(this.adapter_, data, input.amount, this.logger_)
    // Espelho de auditoria no data (o core guarda os refunds autoritativos):
    // amount deste reembolso em minor units, verbatim — parcial incluído.
    return {
      data: {
        ...data,
        refunded_at: new Date().toISOString(),
        ...(input.amount !== undefined
          ? { last_refunded_amount: input.amount }
          : {}),
      },
    }
  }

  override async cancelPayment(
    input: CancelPaymentInput
  ): Promise<CancelPaymentOutput> {
    const data = (input.data ?? {}) as SessionData
    // Capturada não se cancela — é refund (cancel é sucesso local
    // apenas para cobrança não finalizada).
    if (data.captured_at) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "pos-terminal: cancelamento de cobrança já capturada (usar refund)"
      )
    }
    if (this.adapter_) return mpCancel(this.adapter_, data, this.logger_)
    return {
      data: { ...data, canceled_at: new Date().toISOString() },
    }
  }

  override async deletePayment(
    _input: DeletePaymentInput
  ): Promise<DeletePaymentOutput> {
    // Deleção limpa o estado.
    return { data: {} }
  }

  override async retrievePayment(
    input: RetrievePaymentInput
  ): Promise<RetrievePaymentOutput> {
    return { data: (input.data ?? {}) as SessionData }
  }

  override async updatePayment(
    input: UpdatePaymentInput
  ): Promise<UpdatePaymentOutput> {
    // O data é replayado pelo cliente — valida na fronteira antes de ecoar
    // (defesas na fronteira; rejeita __proto__/constructor/prototype).
    assertSafeSessionKeys(input.data as Record<string, unknown> | undefined)
    const parsed = posTerminalSessionSchema.safeParse(input.data ?? {})
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    return { data: mergeSessionData({}, parsed.data) }
  }

  override async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    // Nunca lança — erro degrada para pending (padrão paypal-integration).
    // mpPoll garante no-throw (degrada pending internamente).
    if (this.adapter_) {
      return mpPoll(
        this.adapter_,
        (input.data ?? {}) as SessionData,
        this.logger_
      )
    }
    try {
      return mapStatus((input.data ?? {}) as SessionData)
    } catch {
      return mapStatus({})
    }
  }

  override async getWebhookActionAndData(payload: {
    data: SessionData
    rawData: Buffer
    headers: Record<string, string>
  }): Promise<WebhookActionResult> {
    // T5 (ADR 0007): valida HMAC, re-fetcha e mapeia — nunca lança.
    if (!this.adapter_) return { action: "not_supported" }
    return mpWebhookAction(
      this.adapter_,
      payload,
      this.options_.webhookSecret ?? "",
      this.logger_
    )
  }
}

export default PosTerminalProviderService
