// Interfaz propia del proveedor LLM. El ciclo del agente solo conoce estos tipos:
// cambiar de proveedor no toca el ciclo.

export interface LlamadaHerramienta {
  id: string
  nombre: string
  args: unknown
}

export type Mensaje =
  | { rol: "system"; texto: string }
  | { rol: "user"; texto: string }
  | { rol: "assistant"; texto: string; llamadas: LlamadaHerramienta[] }
  | { rol: "tool"; id: string; nombre: string; contenido: string }

export interface DefinicionHerramienta {
  nombre: string
  descripcion: string
  /** JSON Schema de los argumentos. */
  parametros: Record<string, unknown>
}

export interface RespuestaLlm {
  texto: string
  llamadas: LlamadaHerramienta[]
  tokens: number
}

export interface LlmAdapter {
  proveedor: string
  modelo: string
  enviar(mensajes: Mensaje[], herramientas: DefinicionHerramienta[]): Promise<RespuestaLlm>
}

/** JSON Schema sin la clave $schema, que algunos proveedores rechazan. */
export function esquemaLimpio(parametros: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _omitido, ...resto } = parametros
  return resto
}
