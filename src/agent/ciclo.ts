import { readFile } from "node:fs/promises"
import path from "node:path"
import { config } from "../config.ts"
import { correoDelMensaje, esConfirmacion, otorgarConfirmacion, otorgarPermiso, revocarPermisos } from "../domain/confirmaciones.ts"
import type { Remitente } from "../domain/correo.ts"
import { mensajeDeError } from "../domain/resultado.ts"
import type { DefinicionHerramienta, LlamadaHerramienta, LlmAdapter, Mensaje } from "../llm/adapter.ts"
import { buscarHerramienta, herramientas } from "../tools/registro.ts"
import type { Sesion, ToolCallVisible } from "./sesiones.ts"

export interface RespuestaTurno {
  reply: string
  toolCalls: ToolCallVisible[]
  needsConfirmation: boolean
  /** El front muestra el campo de correo (HU-7) tras un envío simulado. */
  pideCorreo: boolean
}

const todas: DefinicionHerramienta[] = herramientas.map((h) => ({ nombre: h.nombre, descripcion: h.descripcion, parametros: h.parametros }))

/** Sin remitente configurado, el modelo ni siquiera ve la herramienta de correo real. */
function definicionesPara(remitente?: Remitente): DefinicionHerramienta[] {
  return remitente ? todas : todas.filter((d) => d.nombre !== "proveedor_enviar_correo")
}

/** System prompt = comportamiento (agent/prompt.md) + conocimiento (src/knowledge/registro-proveedor.md). */
async function systemPrompt(raiz: string): Promise<string> {
  const [prompt, conocimiento] = await Promise.all([
    readFile(path.join(raiz, "agent", "prompt.md"), "utf8"),
    readFile(path.join(raiz, "src", "knowledge", "registro-proveedor.md"), "utf8"),
  ])
  return `${prompt}\n\n---\n\n# Conocimiento del proceso\n\n${conocimiento}`
}

/** Oculta números largos (cuentas bancarias) en lo que se muestra en el chat. */
export function enmascarar(valor: unknown): unknown {
  return JSON.parse(JSON.stringify(valor ?? null).replace(/\b\d{6,}(\d{4})\b/g, "******$1"))
}

function casoDe(args: unknown): string | undefined {
  const caso = (args as { caso?: unknown } | null)?.caso
  return typeof caso === "string" ? caso : undefined
}

async function ejecutarLlamada(sesion: Sesion, llamada: LlamadaHerramienta, raiz: string, remitente?: Remitente): Promise<{ contenido: string; visible: ToolCallVisible }> {
  const herramienta = buscarHerramienta(llamada.nombre)
  const contenido = herramienta
    ? await herramienta.ejecutar(llamada.args, { directory: raiz, sessionId: sesion.id, remitente })
    : JSON.stringify({ ok: false, error: `herramienta desconocida: ${llamada.nombre}` })
  const r = JSON.parse(contenido) as { ok: boolean; error?: string; data?: { resumen?: string } }
  const caso = casoDe(llamada.args)
  // Tras armar el paquete (o si un envío fue rechazado) el turno termina pidiendo confirmación.
  if (caso && ((llamada.nombre === "proveedor_armar_paquete" && r.ok) || (llamada.nombre === "proveedor_simular_envio" && !r.ok && r.error === "requiere confirmación explícita"))) {
    sesion.pendiente = caso
  }
  // Si el envío real falló por algo reintentable, se vuelve a mostrar el campo de correo.
  if (llamada.nombre === "proveedor_enviar_correo" && !r.ok && !/límite|máximo|dominios/.test(r.error ?? "")) sesion.ofrecerCorreo = true
  if (llamada.nombre === "proveedor_simular_envio" && r.ok) {
    sesion.pendiente = undefined
    sesion.ofrecerCorreo = true
  }
  const visible = { nombre: llamada.nombre, args: enmascarar(llamada.args), ok: r.ok, resumen: r.ok ? r.data?.resumen ?? "ok" : r.error ?? "error" }
  return { contenido, visible }
}

/** CA3/RN4: solo el mensaje inmediatamente posterior a la pregunta puede confirmar. */
function procesarConfirmacion(sesion: Sesion, texto: string): void {
  revocarPermisos(sesion.id)
  if (sesion.pendiente && esConfirmacion(texto)) otorgarConfirmacion(sesion.id, sesion.pendiente)
  // HU-7: el único destinatario válido es el correo que el usuario escribió en este mensaje.
  const correo = correoDelMensaje(texto)
  if (correo) otorgarPermiso(sesion.id, "correo", correo)
  sesion.pendiente = undefined
}

function mensajeTope(toolCalls: ToolCallVisible[], porTokens: boolean): string {
  const hechos = toolCalls.map((t) => `- ${t.nombre}: ${t.resumen}`).join("\n")
  const motivo = porTokens
    ? `Esta sesión alcanzó el tope de ${config.maxTokensSesion} tokens.`
    : `Alcancé el tope de ${config.maxIter} pasos en este turno.`
  const siguiente = porTokens ? "Abre una sesión nueva para continuar." : "Falta completar el resto; pídeme continuar."
  return `${motivo} Esto es lo que logré:\n${hechos || "- nada todavía"}\n\n${siguiente}`
}

export async function ejecutarTurno(sesion: Sesion, texto: string, llm: LlmAdapter, raiz: string, remitente?: Remitente): Promise<RespuestaTurno> {
  const ts = new Date().toISOString()
  sesion.historial.push({ rol: "user", texto, ts })
  const toolCalls: ToolCallVisible[] = []
  let reply = ""
  sesion.ofrecerCorreo = false

  if (sesion.tokens >= config.maxTokensSesion) {
    reply = `Esta sesión alcanzó el tope de ${config.maxTokensSesion} tokens. Abre una sesión nueva para continuar.`
  } else {
    procesarConfirmacion(sesion, texto)
    sesion.mensajes.push({ rol: "user", texto })
    try {
      const system: Mensaje = { rol: "system", texto: await systemPrompt(raiz) }
      let terminado = false
      for (let i = 0; i < config.maxIter && !terminado; i++) {
        const r = await llm.enviar([system, ...sesion.mensajes], definicionesPara(remitente))
        sesion.tokens += r.tokens
        sesion.mensajes.push({ rol: "assistant", texto: r.texto, llamadas: r.llamadas })
        if (r.llamadas.length === 0) {
          reply = r.texto
          terminado = true
          break
        }
        for (const llamada of r.llamadas) {
          const { contenido, visible } = await ejecutarLlamada(sesion, llamada, raiz, remitente)
          sesion.mensajes.push({ rol: "tool", id: llamada.id, nombre: llamada.nombre, contenido })
          toolCalls.push(visible)
        }
        if (sesion.tokens >= config.maxTokensSesion) break
      }
      if (!terminado) reply = mensajeTope(toolCalls, sesion.tokens >= config.maxTokensSesion)
    } catch (e) {
      // CA5: el error se muestra en claro y la sesión sigue viva.
      const motivo = e instanceof Error && e.name.includes("Timeout") ? "el modelo tardó demasiado en responder" : mensajeDeError(e)
      reply = `No pude completar la respuesta porque falló la conexión con el modelo (${motivo}). La sesión sigue activa: intenta de nuevo.`
    }
  }
  revocarPermisos(sesion.id)
  const needsConfirmation = Boolean(sesion.pendiente)
  const pideCorreo = Boolean(remitente && sesion.ofrecerCorreo)
  sesion.historial.push({ rol: "assistant", texto: reply, ts: new Date().toISOString(), toolCalls, needsConfirmation })
  return { reply, toolCalls, needsConfirmation, pideCorreo }
}
