// Configuración leída de variables de entorno. Ningún secreto se exporta hacia el front ni los logs.

function entero(nombre: string, porDefecto: number): number {
  const valor = Number(process.env[nombre])
  return Number.isFinite(valor) && valor > 0 ? valor : porDefecto
}

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export const config = {
  proveedor: process.env.LLM_PROVIDER ?? "anthropic",
  modelo: process.env.LLM_MODEL ?? "claude-sonnet-5",
  ollamaUrl: process.env.OLLAMA_URL ?? "http://localhost:11434",
  accessKey: process.env.ACCESS_KEY ?? "",
  maxIter: entero("MAX_ITER", 25),
  maxTokensSesion: entero("MAX_TOKENS_SESION", 50000),
  rateLimitPorMin: entero("RATE_LIMIT_POR_MIN", 10),
  timeoutMs: entero("LLM_TIMEOUT_MS", 60000),
  puerto: entero("PORT", 3000),
  /** Interruptor del envío real por Gmail (HU-7). Apagado salvo GMAIL_ENABLED=true. */
  correoHabilitado: process.env.GMAIL_ENABLED === "true",
  correoMaxDia: entero("CORREO_MAX_DIA", 10),
  correoMaxSesion: entero("CORREO_MAX_SESION", 3),
  /** Dominios a los que se permite enviar; vacío = cualquiera. */
  dominiosPermitidos: (process.env.EMAIL_DOMINIOS_PERMITIDOS ?? "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean),
}

/** Fecha contra la que se evalúan vigencias. Fijarla hace el resultado determinista. */
export function fechaEjecucion(): string {
  const fecha = process.env.FECHA_EJECUCION
  return fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : hoyISO()
}
