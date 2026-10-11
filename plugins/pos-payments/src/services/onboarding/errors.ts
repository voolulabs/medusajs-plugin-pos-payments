/** Erros tipados do onboarding — a rota converte em resposta sem vazar
 * detalhe interno (onboarding.md §7/§8). */
export class OnboardingError extends Error {
  constructor(
    public readonly code:
      | "invalid_state"
      | "invalid_credential"
      | "platform_config"
      | "not_connected"
      | "reauthorize"
      | "crypto",
    public readonly status: number,
    message: string
  ) {
    super(message)
    this.name = "OnboardingError"
  }
}
