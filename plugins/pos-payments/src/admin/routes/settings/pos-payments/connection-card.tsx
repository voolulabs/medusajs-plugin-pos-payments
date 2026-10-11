import { Badge, Button, Container, Heading, Input, Text } from "@medusajs/ui"
import { connectionLabel } from "../../../../services/onboarding/labels"
import type { ConnectionView } from "./onboarding-data"

interface Props {
  mp: ConnectionView | undefined
  busy: boolean
  error: string | null
  pastedToken: string
  onPastedTokenChange: (value: string) => void
  onConnect: () => void
  onDisconnect: () => void
  onPaste: () => void
}

/** Card da conexão Mercado Pago: estado (máquina §4), Conectar (OAuth
 * full-page), credencial colada opcional e Desconectar (purga + audit). */
export const ConnectionCard = ({
  mp,
  busy,
  error,
  pastedToken,
  onPastedTokenChange,
  onConnect,
  onDisconnect,
  onPaste,
}: Props) => {
  const connected = mp?.status === "connected"
  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">POS Payments — Mercado Pago</Heading>
        {connected ? (
          <Button
            variant="secondary"
            size="small"
            disabled={busy}
            onClick={onDisconnect}
          >
            Desconectar
          </Button>
        ) : (
          <Button size="small" disabled={busy} onClick={onConnect}>
            Conectar (OAuth)
          </Button>
        )}
      </div>
      <div className="px-6 py-4">
        <Text>
          Estado:{" "}
          <Badge color={connected ? "green" : "orange"}>
            {connectionLabel((mp?.status ?? "unconfigured") as never, {
              actionReason: mp?.actionReason ?? null,
            })}
          </Badge>
        </Text>
        {!connected && (
          <div className="mt-3 flex items-center gap-x-2">
            <Input
              placeholder="token do lojista (credencial colada — opcional)"
              value={pastedToken}
              type="password"
              onChange={(e) => onPastedTokenChange(e.target.value)}
            />
            <Button
              variant="secondary"
              size="small"
              disabled={busy || pastedToken.length < 20}
              onClick={onPaste}
            >
              Validar e conectar
            </Button>
          </div>
        )}
        {error && (
          <Text size="small" className="text-ui-fg-error">
            {error}
          </Text>
        )}
      </div>
    </Container>
  )
}
