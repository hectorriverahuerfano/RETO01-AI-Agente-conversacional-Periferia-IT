import { appendFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { dirOut, PATRON_CASO } from "./rutas.ts"

export interface EntradaLog {
  ts: string
  herramienta: string
  ok: boolean
  resumen: string
}

/** RN5 y CA4: cada ejecución queda en out/log.jsonl y en out/<caso>/log.jsonl. Solo resúmenes, sin valores. */
export async function registrar(raiz: string, caso: string, entrada: Omit<EntradaLog, "ts">): Promise<void> {
  const linea = JSON.stringify({ ts: new Date().toISOString(), ...entrada }) + "\n"
  const out = dirOut(raiz)
  await mkdir(out, { recursive: true })
  await appendFile(path.join(out, "log.jsonl"), linea, "utf8")
  if (PATRON_CASO.test(caso)) {
    const dirCaso = path.join(out, caso)
    await mkdir(dirCaso, { recursive: true })
    await appendFile(path.join(dirCaso, "log.jsonl"), linea, "utf8")
  }
}
