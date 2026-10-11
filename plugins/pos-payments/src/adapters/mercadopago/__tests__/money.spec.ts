import { describe, expect, it } from "vitest"
import { minorUnitsToDecimalString } from "../money"
import { MpContractError } from "../types"

describe("minorUnitsToDecimalString — conversão única de dinheiro", () => {
  it.each([
    [1999, "19.99"],
    [5, "0.05"],
    [100000, "1000.00"],
    [0, "0.00"],
  ])("%i minor units → %s", (minor, expected) => {
    expect(minorUnitsToDecimalString(minor)).toBe(expected)
  })

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN])(
    "rejeita valor fora do domínio de inteiros seguros >= 0: %s",
    (invalid) => {
      expect(() => minorUnitsToDecimalString(invalid)).toThrow(MpContractError)
    }
  )
})
