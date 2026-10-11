import { Module } from "@medusajs/framework/utils"
import PosPaymentsModuleService from "./service"

/** Módulo do plugin (onboarding.md §5.2): nome camelCase — hífen quebra a
 * resolução (validateModuleName do core, verificado no fonte 2.21.1). O
 * loader do core auto-descobre dist/modules/<nome> quando o plugin está no
 * array `plugins` (get-resolved-plugins.ts + merge-plugin-modules.ts). */
export default Module("posPayments", { service: PosPaymentsModuleService })
