import Anthropic from "@anthropic-ai/sdk"
import { esquemaLimpio, type DefinicionHerramienta, type LlmAdapter, type Mensaje, type RespuestaLlm } from "./adapter.ts"

type Bloque = Anthropic.ContentBlockParam

/** Traduce el formato interno al de Anthropic: system aparte, tool_use / tool_result en bloques. */
function convertir(mensajes: Mensaje[]): { system: string; messages: Anthropic.MessageParam[] } {
  const system = mensajes.filter((m) => m.rol === "system").map((m) => m.texto).join("\n\n")
  const messages: Anthropic.MessageParam[] = []
  const agregar = (role: "user" | "assistant", bloques: Bloque[]) => {
    const ultimo = messages[messages.length - 1]
    if (ultimo && ultimo.role === role && Array.isArray(ultimo.content)) ultimo.content.push(...bloques)
    else messages.push({ role, content: bloques })
  }
  for (const m of mensajes) {
    if (m.rol === "user") agregar("user", [{ type: "text", text: m.texto }])
    if (m.rol === "tool") agregar("user", [{ type: "tool_result", tool_use_id: m.id, content: m.contenido }])
    if (m.rol === "assistant") {
      const bloques: Bloque[] = m.texto ? [{ type: "text", text: m.texto }] : []
      for (const l of m.llamadas) bloques.push({ type: "tool_use", id: l.id, name: l.nombre, input: l.args ?? {} })
      if (bloques.length) agregar("assistant", bloques)
    }
  }
  return { system, messages }
}

export function crearAnthropic(modelo: string, timeoutMs: number): LlmAdapter {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error("falta ANTHROPIC_API_KEY en el entorno del backend")
  const cliente = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 1 })
  return {
    proveedor: "anthropic",
    modelo,
    async enviar(mensajes: Mensaje[], herramientas: DefinicionHerramienta[]): Promise<RespuestaLlm> {
      const { system, messages } = convertir(mensajes)
      const r = await cliente.messages.create({
        model: modelo,
        max_tokens: 2048,
        system,
        messages,
        tools: herramientas.map((h) => ({
          name: h.nombre,
          description: h.descripcion,
          input_schema: esquemaLimpio(h.parametros) as Anthropic.Tool.InputSchema,
        })),
      })
      const texto = r.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n")
      const llamadas = r.content.flatMap((b) => (b.type === "tool_use" ? [{ id: b.id, nombre: b.name, args: b.input }] : []))
      return { texto, llamadas, tokens: r.usage.input_tokens + r.usage.output_tokens }
    },
  }
}
