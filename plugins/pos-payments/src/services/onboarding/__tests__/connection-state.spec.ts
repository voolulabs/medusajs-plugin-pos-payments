import { describe, expect, it } from "vitest"
import {
  CONNECTION_TRANSITIONS,
  IllegalTransitionError,
  assertNeverStatus,
  isConnectionStatus,
  transition,
} from "../connection-state"
import {
  ACTION_REASON_LABELS,
  CONNECTION_STATUS_LABELS,
  connectionLabel,
} from "../labels"

describe("connection-state (onboarding.md §4)", () => {
  it("todas as transições válidas da máquina passam", () => {
    expect(transition("unconfigured", "connecting")).toBe("connecting")
    expect(transition("unconfigured", "connected")).toBe("connected")
    expect(transition("connecting", "connected")).toBe("connected")
    expect(transition("connecting", "unconfigured")).toBe("unconfigured")
    expect(transition("connected", "action_required")).toBe("action_required")
    expect(transition("connected", "degraded")).toBe("degraded")
    expect(transition("connected", "disconnected")).toBe("disconnected")
    expect(transition("action_required", "connected")).toBe("connected")
    expect(transition("action_required", "disconnected")).toBe("disconnected")
    expect(transition("degraded", "connected")).toBe("connected")
    expect(transition("degraded", "action_required")).toBe("action_required")
    expect(transition("disconnected", "unconfigured")).toBe("unconfigured")
  })

  it("transições inválidas rejeitadas (tabela explícita)", () => {
    expect(() => transition("unconfigured", "degraded")).toThrow(
      IllegalTransitionError
    )
    expect(() => transition("connecting", "degraded")).toThrow(
      IllegalTransitionError
    )
    expect(() => transition("degraded", "unconfigured")).toThrow(
      IllegalTransitionError
    )
    expect(() => transition("disconnected", "connected")).toThrow(
      IllegalTransitionError
    )
    expect(() => transition("connected", "connecting")).toThrow(
      IllegalTransitionError
    )
  })

  it("cada estado da tabela tem rótulo pt-BR e entry de transição", () => {
    for (const s of Object.keys(CONNECTION_TRANSITIONS)) {
      expect(
        CONNECTION_STATUS_LABELS[s as keyof typeof CONNECTION_STATUS_LABELS]
      ).toBeTruthy()
    }
    expect(Object.keys(CONNECTION_STATUS_LABELS).sort()).toEqual(
      Object.keys(CONNECTION_TRANSITIONS).sort()
    )
  })

  it("rótulo de action_required discrimina o reason", () => {
    expect(
      connectionLabel("action_required", { actionReason: "reauthorize" })
    ).toBe("ação necessária: reconectar")
    expect(
      connectionLabel("action_required", { actionReason: "no_terminal" })
    ).toBe("ação necessária: selecionar terminal")
    expect(connectionLabel("action_required")).toBe("ação necessária")
    expect(connectionLabel("connected")).toBe("conectado")
    expect(connectionLabel("connected", { expiringSoon: true })).toBe(
      "conectado (renovando)"
    )
    expect(ACTION_REASON_LABELS.reauthorize).toBe("reconectar")
  })

  it("isConnectionStatus guarda o type guard; assertNever cobre switch", () => {
    expect(isConnectionStatus("connected")).toBe(true)
    expect(isConnectionStatus("outra-coisa")).toBe(false)
    expect(() => assertNeverStatus("x" as never)).toThrow(/não coberto/)
  })
})
