import { config } from "../config.ts"
import type { LlmAdapter } from "./adapter.ts"
import { crearAnthropic } from "./anthropic.ts"
import { crearOllama } from "./ollama.ts"

/** Elige la implementación por LLM_PROVIDER. Agregar un proveedor = un archivo más aquí. */
export function crearAdaptador(): LlmAdapter {
  switch (config.proveedor) {
    case "anthropic":
      return crearAnthropic(config.modelo, config.timeoutMs)
    case "ollama":
      return crearOllama(config.modelo, config.ollamaUrl, config.timeoutMs)
    default:
      throw new Error(`LLM_PROVIDER no soportado: ${config.proveedor}`)
  }
}
