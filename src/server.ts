import { timingSafeEqual } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { Hono, type Context, type Next } from "hono"
import { bodyLimit } from "hono/body-limit"
import { z } from "zod"
import { ejecutarTurno } from "./agent/ciclo.ts"
import { buscarSesion, obtenerSesion, PATRON_SESION } from "./agent/sesiones.ts"
import { config } from "./config.ts"
import { mensajeDeError } from "./domain/resultado.ts"
import type { LlmAdapter } from "./llm/adapter.ts"
import { crearAdaptador } from "./llm/index.ts"

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

app.use("*", async (c, next) => {
  await next()
  c.header("X-Content-Type-Options", "nosniff")
  c.header("Referrer-Policy", "no-referrer")
  c.header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'")
})

app.get("/api/health", (c) => c.json({ ok: true, provider: config.proveedor, model: config.modelo }))

/** Clave de acceso al link: header x-access-key, comparación en tiempo constante, falla cerrado. */
async function exigirClave(c: Context, next: Next) {
  if (!config.accessKey) return c.json({ error: "El servidor no tiene ACCESS_KEY configurada." }, 503)
  const recibida = Buffer.from(c.req.header("x-access-key") ?? "")
  const esperada = Buffer.from(config.accessKey)
  if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) {
    return c.json({ error: "Clave de acceso inválida." }, 401)
  }
  await next()
}

/** Límite de peticiones por IP y minuto para que nadie gaste la clave del modelo sin control. */
const ventanas = new Map<string, { inicio: number; cuenta: number }>()
async function limitarTasa(c: Context, next: Next) {
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local"
  const ahora = Date.now()
  const v = ventanas.get(ip)
  if (!v || ahora - v.inicio > 60_000) ventanas.set(ip, { inicio: ahora, cuenta: 1 })
  else if (++v.cuenta > config.rateLimitPorMin) return c.json({ error: "Demasiadas peticiones. Espera un minuto." }, 429)
  await next()
}

app.use("/api/chat", exigirClave, limitarTasa, bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.json({ error: "Mensaje demasiado largo." }, 413) }))
app.use("/api/sessions/*", exigirClave)

const CuerpoChat = z.object({
  sessionId: z.string().regex(PATRON_SESION),
  message: z.string().trim().min(1).max(4000),
})

const enCurso = new Set<string>()

app.post("/api/chat", async (c) => {
  const cuerpo = CuerpoChat.safeParse(await c.req.json().catch(() => null))
  if (!cuerpo.success) return c.json({ error: "Petición inválida: se espera { sessionId, message }." }, 400)
  if (!llm) return c.json({ error: `El modelo no está disponible: ${errorLlm}` }, 503)
  const { sessionId, message } = cuerpo.data
  if (enCurso.has(sessionId)) return c.json({ error: "Ya hay un mensaje en proceso en esta sesión." }, 409)
  enCurso.add(sessionId)
  try {
    return c.json(await ejecutarTurno(obtenerSesion(sessionId), message, llm, raiz))
  } finally {
    enCurso.delete(sessionId)
  }
})

app.get("/api/sessions/:id", (c) => {
  const id = c.req.param("id")
  const sesion = PATRON_SESION.test(id) ? buscarSesion(id) : undefined
  if (!sesion) return c.json({ error: "Sesión no encontrada." }, 404)
  return c.json({ id: sesion.id, tokens: sesion.tokens, historial: sesion.historial })
})

app.notFound((c) => (c.req.path.startsWith("/api/") ? c.json({ error: "Ruta no encontrada." }, 404) : c.text("No encontrado", 404)))
app.onError((e, c) => {
  console.error(mensajeDeError(e))
  return c.json({ error: "Error interno. La sesión sigue activa." }, 500)
})

// Solo web/ es público: out/ y fixtures/ nunca se sirven.
app.use("/*", serveStatic({ root: path.relative(process.cwd(), path.join(raiz, "web")) || "." }))

serve({ fetch: app.fetch, port: config.puerto, hostname: "0.0.0.0" }, (info) => {
  console.log(`Agente listo en http://localhost:${info.port} · ${config.proveedor}/${config.modelo}`)
})
