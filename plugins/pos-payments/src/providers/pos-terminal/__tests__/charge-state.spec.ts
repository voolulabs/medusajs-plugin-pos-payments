import { describe, expect, it } from "vitest"
import {
  ALLOWED_TRANSITIONS,
  CHARGE_DATA_VERSION,
  TransitionError,
  applyTransition,
  transition,
} from "../charge-state"
import type { ChargeState } from "../../../adapters/types"

describe("ALLOWED_TRANSITIONS + mutator único (CONSTRAINTS 2)", () => {
  it("toda transição declarada é aceita e toda terminal é fechada", () => {
    const states = Object.keys(ALLOWED_TRANSITIONS) as ChargeState[]
    for (const from of states) {
      for (const to of ALLOWED_TRANSITIONS[from]) {
        expect(transition(from, to)).toEqual({ state: to, changed: true })
      }
      if (["failed", "expired", "canceled", "refunded"].includes(from)) {
        expect(ALLOWED_TRANSITIONS[from]).toEqual([])
      }
    }
  })

  it("transições proibidas lançam TransitionError", () => {
    for (const [from, to] of [
      ["paid", "pending"],
      ["failed", "paid"],
      ["refunded", "paid"],
      ["canceled", "paid"],
      ["expired", "paid"],
    ] as const) {
      expect(() => transition(from, to)).toThrow(TransitionError)
    }
  })

  it("mesmo estado é no-op idempotente (poll repetido converge)", () => {
    expect(transition("paid", "paid")).toEqual({
      state: "paid",
      changed: false,
    })
    expect(transition("awaiting_terminal", "awaiting_terminal").changed).toBe(
      false
    )
  })

  it("applyTransition grava state + data_version (CONSTRAINTS 6)", () => {
    const out = applyTransition({ charge_id: "ORD-1" }, "awaiting_terminal")
    expect(out.state).toBe("awaiting_terminal")
    expect(out.data_version).toBe(CHARGE_DATA_VERSION)
    expect(out.charge_id).toBe("ORD-1")
  })
})
