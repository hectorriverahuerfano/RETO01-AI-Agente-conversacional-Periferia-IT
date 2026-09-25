import type { Mensaje } from "../llm/adapter.ts"

export interface ToolCallVisible {
  nombre: string
  args: unknown
  ok: boolean
  resumen: string
}

export interface EntradaHistorial {
  rol: "user" | "assistant"
  texto: string
  ts: string
  toolCalls?: ToolCallVisible[]
  needsConfirmation?: boolean
}

export interface Sesion {
  id: string
  /** Conversación en formato interno para el modelo (sin el system prompt). */
  mensajes: Mensaje[]
  /** Lo que ve la persona en el chat. */
  historial: EntradaHistorial[]
  tokens: number
  /** Caso cuyo envío espera confirmación en el próximo mensaje del usuario. */
  pendiente?: string
}

export const PATRON_SESION = /^[A-Za-z0-9_-]{8,64}$/
const MAX_SESIONES = 500
const sesiones = new Map<string, Sesion>()

export function obtenerSesion(id: string): Sesion {
  let s = sesiones.get(id)
  if (!s) {
    if (sesiones.size >= MAX_SESIONES) {
      const masVieja = sesiones.keys().next().value
      if (masVieja) sesiones.delete(masVieja)
    }
    s = { id, mensajes: [], historial: [], tokens: 0 }
    sesiones.set(id, s)
  }
  return s
}

export function buscarSesion(id: string): Sesion | undefined {
  return sesiones.get(id)
}
