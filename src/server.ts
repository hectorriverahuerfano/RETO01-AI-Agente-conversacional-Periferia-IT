import path from "node:path"
import { fileURLToPath } from "node:url"
import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { Hono, type Context, type Next } from "hono"
import { bodyLimit } from "hono/body-limit"
import { z } from "zod"
import { ejecutarTurno } from "./agent/ciclo.ts"
import { buscarSesion, eliminarSesion, obtenerSesion, PATRON_SESION } from "./agent/sesiones.ts"
import { olvidarSesion } from "./domain/confirmaciones.ts"
import { config } from "./config.ts"
import { mensajeDeError } from "./domain/resultado.ts"
import type { LlmAdapter } from "./llm/adapter.ts"
import { crearAdaptador } from "./llm/index.ts"
import { remitenteDesdeEntorno } from "./domain/correo.ts"
import { exigirSesion, ipCliente, rutasSesion } from "./http/auth.ts"

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const app = new Hono()

let llm: LlmAdapter | undefined
let errorLlm: string | undefined
try {
  llm = crearAdaptador()
} catch (e) {
  errorLlm = mensajeDeError(e)
  console.error(`Adaptador LLM no disponible: ${errorLlm}`)
}

// HU-7: envío real por Gmail solo si GMAIL_ENABLED=true y hay credenciales en el entorno.
const remitente = config.correoHabilitado ? remitenteDesdeEntorno(config.timeoutMs) : undefined

app.use("*", async (c, next) => {
  await next()
  c.header("X-Content-Type-Options", "nosniff")
  c.header("Referrer-Policy", "no-referrer")
  c.header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'")
})

app.get("/api/health", (c) => c.json({ ok: true, provider: config.proveedor, model: config.modelo, correo: Boolean(remitente) }))

// Inicio de sesión (HU-9): /api/sesion, /api/login y /api/logout.
app.use("/api/login", bodyLimit({ maxSize: 2 * 1024, onError: (c) => c.json({ ok: false, error: "Petición demasiado grande." }, 413) }))
app.route("/", rutasSesion)

/** Límite de peticiones por IP y minuto; cada ruta lleva su propio contador. */
function limitador(maxPorMin: number) {
  const ventanas = new Map<string, { inicio: number; cuenta: number }>()
  return async (c: Context, next: Next) => {
    const ip = ipCliente(c)
    const ahora = Date.now()
    const v = ventanas.get(ip)
    if (!v || ahora - v.inicio > 60_000) ventanas.set(ip, { inicio: ahora, cuenta: 1 })
    else if (++v.cuenta > maxPorMin) return c.json({ ok: false, error: "Demasiadas peticiones. Espera un minuto." }, 429)
    await next()
  }
}

// El chat gasta la clave del modelo; el historial solo lee memoria, por eso tiene más margen.
app.use("/api/chat", exigirSesion, limitador(config.rateLimitPorMin), bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.json({ ok: false, error: "Mensaje demasiado largo." }, 413) }))
app.use("/api/sessions/*", exigirSesion, limitador(config.rateLimitPorMin * 3))

const CuerpoChat = z.object({
  sessionId: z.string().regex(PATRON_SESION),
  message: z.string().trim().min(1).max(4000),
})

const enCurso = new Set<string>()

app.post("/api/chat", async (c) => {
  const cuerpo = CuerpoChat.safeParse(await c.req.json().catch(() => null))
  if (!cuerpo.success) return c.json({ ok: false, error: "Petición inválida: se espera { sessionId, message }." }, 400)
  if (!llm) return c.json({ ok: false, error: `El modelo no está disponible: ${errorLlm}` }, 503)
  const { sessionId, message } = cuerpo.data
  if (enCurso.has(sessionId)) return c.json({ ok: false, error: "Ya hay un mensaje en proceso en esta sesión." }, 409)
  enCurso.add(sessionId)
  try {
    return c.json(await ejecutarTurno(obtenerSesion(sessionId), message, llm, raiz, remitente))
  } finally {
    enCurso.delete(sessionId)
  }
})

app.get("/api/sessions/:id", (c) => {
  const id = c.req.param("id")
  const sesion = PATRON_SESION.test(id) ? buscarSesion(id) : undefined
  if (!sesion) return c.json({ ok: false, error: "Sesión no encontrada." }, 404)
  return c.json({ id: sesion.id, tokens: sesion.tokens, historial: sesion.historial })
})

// Borra una conversación del servidor. Responde 204 exista o no, para no revelar qué ids existen.
app.delete("/api/sessions/:id", (c) => {
  const id = c.req.param("id")
  if (!PATRON_SESION.test(id)) return c.json({ ok: false, error: "Identificador inválido." }, 400)
  if (enCurso.has(id)) return c.json({ ok: false, error: "Hay un mensaje en proceso en esta sesión." }, 409)
  eliminarSesion(id)
  olvidarSesion(id)
  return c.body(null, 204)
})

app.notFound((c) => (c.req.path.startsWith("/api/") ? c.json({ ok: false, error: "Ruta no encontrada." }, 404) : c.text("No encontrado", 404)))
app.onError((e, c) => {
  console.error(mensajeDeError(e))
  return c.json({ ok: false, error: "Error interno. La sesión sigue activa." }, 500)
})

// Solo web/ es público: out/ y fixtures/ nunca se sirven.
app.use("/*", serveStatic({ root: path.relative(process.cwd(), path.join(raiz, "web")) || "." }))

serve({ fetch: app.fetch, port: config.puerto, hostname: "0.0.0.0" }, (info) => {
  console.log(`Agente listo en http://localhost:${info.port} · ${config.proveedor}/${config.modelo}`)
})
