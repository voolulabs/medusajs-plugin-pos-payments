import { describe, expect, it } from "vitest"
import { mapOrderStatus } from "../status"
import { MpContractError, type MpOrder, type MpOrderStatus } from "../types"

function order(status: MpOrderStatus, extra?: Partial<MpOrder>): MpOrder {
  return { id: "ORD-1", status, ...extra }
}

describe("máquina qr (type-aware)", () => {
  it.each(["created", "processed", "canceled", "expired", "refunded"] as const)(
    "aceita %s",
    (s) => {
      expect(mapOrderStatus(order(s, { type: "qr" })).state).toBeDefined()
    }
  )

  it.each(["at_terminal", "action_required", "failed"] as const)(
    "rejeita %s na máquina qr",
    (s) => {
      expect(() => mapOrderStatus(order(s, { type: "qr" }))).toThrow(
        MpContractError
      )
    }
  )

  it("type presente fora do escopo presencial falha fechado", () => {
    expect(() => mapOrderStatus(order("created", { type: "online" }))).toThrow(
      MpContractError
    )
  })
})

describe("fail-closed contra valores hostis", () => {
  it("status fora do enum lança", () => {
    expect(() => mapOrderStatus(order("in_dispute" as MpOrderStatus))).toThrow(
      MpContractError
    )
  })

  it("chaves herdadas de protótipo não passam na guarda", () => {
    const fantasmas: string[] = ["toString", "__proto__", "constructor"]
    for (const fantasma of fantasmas) {
      expect(() => mapOrderStatus(order(fantasma as MpOrderStatus))).toThrow(
        MpContractError
      )
    }
  })
})
