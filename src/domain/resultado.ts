// Contrato de salida de las herramientas: { ok: true, data } | { ok: false, error }.

export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string }

export function exito<T>(data: T): Resultado<T> {
  return { ok: true, data }
}

export function fallo<T = never>(error: string): Resultado<T> {
  return { ok: false, error }
}

/** Convierte cualquier excepción en un mensaje claro, sin traza ni rutas absolutas. */
export function mensajeDeError(e: unknown): string {
  const texto = e instanceof Error ? e.message : String(e)
  return texto.replace(/[A-Za-z]:\\[^\s"']+|\/(?:[\w.-]+\/)+[\w.-]+/g, "<ruta>")
}
