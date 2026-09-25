// Genera modulo/agent.md y modulo/skill/registro-proveedor/SKILL.md desde las fuentes de la app.
// Así el módulo nunca diverge: agent/prompt.md y src/knowledge/registro-proveedor.md son la única fuente.
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

export async function contenidoModulo(): Promise<Record<string, string>> {
  const prompt = await readFile(path.join(raiz, "agent", "prompt.md"), "utf8")
  const conocimiento = await readFile(path.join(raiz, "src", "knowledge", "registro-proveedor.md"), "utf8")
  return {
    "modulo/agent.md": [
      "---",
      "description: Agente que llena formularios de registro como proveedor desde el repositorio maestro y arma el paquete para firma, sin enviar nada sin confirmación.",
      "mode: primary",
      "permission:",
      "  edit: deny",
      "  bash: deny",
      "---",
      "",
      prompt,
    ].join("\n"),
    "modulo/skill/registro-proveedor/SKILL.md": [
      "---",
      "name: registro-proveedor",
      "description: Conocimiento del proceso de registro como proveedor de Periferia IT Group - estados de campos, identificador tributario por país, datos bancarios, vigencia de soportes y confirmación humana.",
      "---",
      "",
      conocimiento,
    ].join("\n"),
  }
}

async function main(): Promise<void> {
  for (const [relativa, contenido] of Object.entries(await contenidoModulo())) {
    const destino = path.join(raiz, relativa)
    await mkdir(path.dirname(destino), { recursive: true })
    await writeFile(destino, contenido, "utf8")
    console.log(`generado ${relativa}`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main()
