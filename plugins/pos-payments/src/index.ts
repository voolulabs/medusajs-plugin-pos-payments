import type { PosPaymentsPluginOptions } from "./types"
import { PLUGIN_NAME } from "./utils/plugin-options"

export default function PosPaymentsPlugin(
  options: PosPaymentsPluginOptions = {}
) {
  return {
    resolve: PLUGIN_NAME,
    options: options as Record<string, unknown>,
  }
}

export type { PosPaymentsPluginOptions }
// Contrato público do provider (options por registro + session data — ADR 0002/§12 do plano)
export type { PosTerminalOptions } from "./providers/pos-terminal/service"
export type { PosTerminalSessionData } from "./types"
