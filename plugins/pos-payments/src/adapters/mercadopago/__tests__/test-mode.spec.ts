import { describe, expect, it } from "vitest"
import {
  SANDBOX_SERIAL_PREFIX,
  assertTerminalAllowedByMode,
  isSandboxTerminal,
} from "../test-mode"

describe("isSandboxTerminal (predicado puro)", () => {
  it("reconhece o terminal virtual da homologação nos dois poi_types", () => {
    expect(isSandboxTerminal("NEWLAND_N950__SBX0000001")).toBe(true)
    expect(isSandboxTerminal("PAX_A910__SBX0000001")).toBe(true)
  })

  it("serial de produção não é sandbox", () => {
    expect(isSandboxTerminal("NEWLAND_N950__S1")).toBe(false)
    expect(isSandboxTerminal("PAX_A910__ABC123")).toBe(false)
  })

  it("id sem '__' não é sandbox (formato é responsabilidade do assertTerminalId)", () => {
    expect(isSandboxTerminal("SBX0000001")).toBe(false)
    expect(isSandboxTerminal("garbage")).toBe(false)
  })

  it("serial minúsculo também é sandbox (case não fura o guard)", () => {
    expect(isSandboxTerminal("NEWLAND_N950__sbx0000001")).toBe(true)
    expect(isSandboxTerminal("PAX_A910__Sbx1")).toBe(true)
  })

  it("poi_type com '__' não esconde o serial (lastIndexOf)", () => {
    expect(isSandboxTerminal("NE__WLAND__SBX0000001")).toBe(true)
    expect(isSandboxTerminal("NE__WLAND__S1")).toBe(false)
  })

  it("o prefixo exportado é o contrato do §8", () => {
    expect(SANDBOX_SERIAL_PREFIX).toBe("SBX")
  })
})

describe("assertTerminalAllowedByMode (fail-closed)", () => {
  it("sandbox sem o guard lança citando MP_POINT_TEST_MODE", () => {
    expect(() =>
      assertTerminalAllowedByMode("NEWLAND_N950__SBX0000001", false)
    ).toThrow(/MP_POINT_TEST_MODE/)
  })

  it("sandbox COM o guard passa", () => {
    expect(() =>
      assertTerminalAllowedByMode("NEWLAND_N950__SBX0000001", true)
    ).not.toThrow()
  })

  it("produção passa com ou sem o guard", () => {
    expect(() =>
      assertTerminalAllowedByMode("NEWLAND_N950__S1", false)
    ).not.toThrow()
    expect(() =>
      assertTerminalAllowedByMode("NEWLAND_N950__S1", true)
    ).not.toThrow()
  })
})
