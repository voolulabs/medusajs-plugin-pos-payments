import { Button, Container, Heading, Text } from "@medusajs/ui"
import type { RegisterMap, TerminalView } from "./onboarding-data"

/** Cards de listagem: terminais do lojista (seleção) e "Terminais por caixa"
 * (binding {register_id, adquirente} → terminal, onboarding.md §5.4). */

interface TerminalsProps {
  terminals: TerminalView[]
  busy: boolean
  onSelect: (terminalId: string) => void
}

export const TerminalsCard = ({
  terminals,
  busy,
  onSelect,
}: TerminalsProps) => (
  <Container className="p-0">
    <div className="px-6 py-4">
      <Heading level="h3">Terminais do lojista</Heading>
    </div>
    <div className="flex flex-col gap-y-2 px-6 pb-4">
      {terminals.map((t) => (
        <div
          key={t.id}
          className="flex items-center justify-between rounded border px-3 py-2"
        >
          <Text size="small">{t.id}</Text>
          <Button
            variant="secondary"
            size="small"
            disabled={busy}
            onClick={() => onSelect(t.id)}
          >
            Selecionar
          </Button>
        </div>
      ))}
      {terminals.length === 0 && (
        <Text size="small">
          Nenhum terminal listado — conecte e pareie a maquininha no app Mercado
          Pago.
        </Text>
      )}
    </div>
  </Container>
)

interface RegistersProps {
  registers: RegisterMap
}

export const RegistersCard = ({ registers }: RegistersProps) => {
  const entries = Object.entries(registers)
  return (
    <Container className="p-0">
      <div className="px-6 py-4">
        <Heading level="h3">Terminais por caixa</Heading>
      </div>
      <div className="flex flex-col gap-y-2 px-6 pb-4">
        {entries.map(([rid, info]) => (
          <div
            key={rid}
            className="flex items-center justify-between rounded border px-3 py-2"
          >
            <Text size="small">
              {info.label ?? rid} → {info.terminal?.id ?? "sem terminal"}
            </Text>
          </div>
        ))}
        {entries.length === 0 && (
          <Text size="small">
            Os caixas aparecem aqui quando o app de caixa reporta o register_id.
          </Text>
        )}
      </div>
    </Container>
  )
}
