import type { z } from "zod"

export interface ContextoHerramienta {
  /** Raíz del proyecto: toda ruta se resuelve desde aquí. */
  directory: string
  sessionId: string
}

/** Contrato §6.2: description, args (zod con .describe()) y execute que devuelve JSON y nunca lanza. */
export interface Herramienta<A extends Record<string, z.ZodType> = Record<string, z.ZodType>> {
  description: string
  args: A
  execute(args: { [K in keyof A]: z.infer<A[K]> }, ctx: ContextoHerramienta): Promise<string>
}
