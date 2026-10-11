import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Text, Badge } from "@medusajs/ui"
import { connectionLabel } from "../../services/onboarding/labels"

/** Widget topbar (Fase 2b, ui-ux-admin.md §3): indicador de conexões
 * incompletas com deep-link para a página de settings. */
const TopbarSetupWidget = () => {
  const [pending, setPending] = useState<string | null>(null)

  useEffect(() => {
    fetch("/admin/pos-payments/connections", { credentials: "include" })
      .then((r) => r.json())
      .then(
        (d: {
          connections?: Array<{
            acquirer: string
            status: string
            actionReason: string | null
          }>
        }) => {
          const incomplete = (d.connections ?? []).find(
            (c) => c.status !== "connected" && c.status !== "unconfigured"
          )
          if (incomplete) {
            setPending(
              connectionLabel(incomplete.status as never, {
                actionReason: incomplete.actionReason,
              })
            )
          }
        }
      )
      .catch(() => undefined)
  }, [])

  if (!pending) return null
  return (
    <Container className="flex items-center justify-between p-3">
      <Text size="small">POS Payments: onboarding incompleto</Text>
      <Link to="/settings/pos-payments">
        <Badge color="orange">{pending}</Badge>
      </Link>
    </Container>
  )
}

export default TopbarSetupWidget

export const config = defineWidgetConfig({
  zone: "topbar",
})
