import type { z } from "zod"
import type { Remitente } from "../domain/correo.ts"

export interface ContextoHerramienta {
  /** Raíz del proyecto: toda ruta se resuelve desde aquí. */
  directory: string
  sessionId: string
  /** Envío real de correo (HU-7). Ausente = no configurado; demo.ts nunca lo pasa. */
  remitente?: Remitente
}

/** Contrato §6.2: description, args (zod con .describe()) y execute que devuelve JSON y nunca lanza. */
export interface Herramienta<A extends Record<string, z.ZodType> = Record<string, z.ZodType>> {
  description: string
  args: A
  execute(args: { [K in keyof A]: z.infer<A[K]> }, ctx: ContextoHerramienta): Promise<string>
}
