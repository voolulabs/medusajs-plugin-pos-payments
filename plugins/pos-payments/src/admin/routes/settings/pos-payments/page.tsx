import { useEffect, useState } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { BuildingTax } from "@medusajs/icons"
import { ConnectionCard } from "./connection-card"
import { RegistersCard, TerminalsCard } from "./lists-cards"
import {
  disconnectAcquirer,
  loadOnboardingState,
  pasteToken,
  selectTerminal,
  startOAuth,
  type OnboardingState,
} from "./onboarding-data"

/** Settings → POS Payments (ui-ux-admin.md §3): conexão por adquirente,
 * terminais e binding por caixa. Handlers curtos; UI nos cards. */
const PosPaymentsSettingsPage = () => {
  const [state, setState] = useState<OnboardingState>({
    connections: [],
    registers: {},
    terminals: [],
  })
  const [busy, setBusy] = useState(false)
  const [pastedToken, setPastedToken] = useState("")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    reload().catch(() => setError("falha ao carregar estado do onboarding"))
  }, [])

  const reload = async () => {
    // Propaga a falha: o chamador decide a mensagem (recarga não apaga erro).
    setState(await loadOnboardingState())
  }

  const act = async (acao: () => Promise<void>, erro: string) => {
    setBusy(true)
    let acaoOk = false
    try {
      await acao()
      acaoOk = true
      await reload()
      setError(null)
    } catch {
      // Recarga falhando depois de ação bem-sucedida não vira mensagem da
      // ação — o estado exibido é antigo, mas o erro é do refresh da página.
      setError(
        acaoOk ? "ação concluída, mas a atualização da página falhou" : erro
      )
    }
    setBusy(false)
  }
  // recarga com falha preserva o erro da ação (reload lança; catch acima mantém)

  const connect = () =>
    act(async () => {
      window.location.assign((await startOAuth()).toString())
    }, "falha ao iniciar OAuth")

  const disconnect = () => act(disconnectAcquirer, "falha ao desconectar")

  const paste = () =>
    act(async () => {
      const ok = await pasteToken(pastedToken)
      setPastedToken("")
      if (!ok) throw new Error("recusada")
    }, "credencial recusada pela adquirente")

  const select = (terminalId: string) =>
    act(() => selectTerminal(terminalId), "falha ao selecionar terminal")

  const mp = state.connections.find((c) => c.acquirer === "mercadopago")
  return (
    <div className="flex flex-col gap-y-3">
      <ConnectionCard
        mp={mp}
        busy={busy}
        error={error}
        pastedToken={pastedToken}
        onPastedTokenChange={setPastedToken}
        onConnect={() => void connect()}
        onDisconnect={() => void disconnect()}
        onPaste={() => void paste()}
      />
      <TerminalsCard
        terminals={state.terminals}
        busy={busy}
        onSelect={(id) => void select(id)}
      />
      <RegistersCard registers={state.registers} />
    </div>
  )
}

export default PosPaymentsSettingsPage

export const config = defineRouteConfig({
  label: "POS Payments",
  icon: BuildingTax,
})
