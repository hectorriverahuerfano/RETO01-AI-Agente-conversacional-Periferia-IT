import { esquemaLimpio, type DefinicionHerramienta, type LlamadaHerramienta, type LlmAdapter, type Mensaje, type RespuestaLlm } from "./adapter.ts"

interface MensajeOllama {
  role: "system" | "user" | "assistant" | "tool"
  content: string
  tool_calls?: { function: { name: string; arguments: unknown } }[]
  tool_name?: string
}

interface RespuestaOllama {
  message?: MensajeOllama
  prompt_eval_count?: number
  eval_count?: number
  error?: string
}

function convertir(mensajes: Mensaje[]): MensajeOllama[] {
  return mensajes.map((m): MensajeOllama => {
    if (m.rol === "tool") return { role: "tool", content: m.contenido, tool_name: m.nombre }
    if (m.rol === "assistant") {
      return { role: "assistant", content: m.texto, tool_calls: m.llamadas.map((l) => ({ function: { name: l.nombre, arguments: l.args } })) }
    }
    return { role: m.rol, content: m.texto }
  })
}

let secuencia = 0
const nuevoId = () => `ollama_${Date.now()}_${secuencia++}`

/** Los modelos pequeños a veces escriben la llamada como JSON en el texto en vez de usar tool_calls. */
function llamadaEnTexto(texto: string, nombres: Set<string>): LlamadaHerramienta | undefined {
  const bloque = texto.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")
  if (!bloque.startsWith("{")) return undefined
  try {
    const j = JSON.parse(bloque) as { name?: unknown; arguments?: unknown }
    if (typeof j.name === "string" && nombres.has(j.name)) return { id: nuevoId(), nombre: j.name, args: j.arguments ?? {} }
  } catch {
    return undefined
  }
  return undefined
}

export function crearOllama(modelo: string, url: string, timeoutMs: number): LlmAdapter {
  return {
    proveedor: "ollama",
    modelo,
    async enviar(mensajes: Mensaje[], herramientas: DefinicionHerramienta[]): Promise<RespuestaLlm> {
      const r = await fetch(`${url.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model: modelo,
          stream: false,
          options: { temperature: 0 },
          messages: convertir(mensajes),
          tools: herramientas.map((h) => ({
            type: "function",
            function: { name: h.nombre, description: h.descripcion, parameters: esquemaLimpio(h.parametros) },
          })),
        }),
      })
      const datos = (await r.json()) as RespuestaOllama
      if (!r.ok || datos.error) throw new Error(`Ollama respondió ${r.status}: ${datos.error ?? "error desconocido"}`)
      const texto = datos.message?.content ?? ""
      let llamadas: LlamadaHerramienta[] = (datos.message?.tool_calls ?? []).map((c) => ({ id: nuevoId(), nombre: c.function.name, args: c.function.arguments }))
      if (llamadas.length === 0) {
        const enTexto = llamadaEnTexto(texto, new Set(herramientas.map((h) => h.nombre)))
        if (enTexto) llamadas = [enTexto]
      }
      return { texto: llamadas.length ? "" : texto, llamadas, tokens: (datos.prompt_eval_count ?? 0) + (datos.eval_count ?? 0) }
    },
  }
}
