import { readFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"

// Las reglas de negocio viven en src/knowledge/reglas.json: cambiarlas no toca código.

const Reglas = z.object({
  identificador_tributario_por_pais: z.record(z.string(), z.string()),
  pais_del_maestro: z.string(),
  clave_identificador: z.string(),
  umbral_lleno: z.number(),
  umbral_confirmacion: z.number(),
  dias_alerta_vencimiento: z.number(),
  claves_bancarias: z.array(z.string()),
  palabras_vacias: z.array(z.string()),
  notas_por_clave: z.record(z.string(), z.string()),
})
export type Reglas = z.infer<typeof Reglas>

export async function leerReglas(raiz: string): Promise<Reglas> {
  const texto = await readFile(path.join(raiz, "src", "knowledge", "reglas.json"), "utf8")
  return Reglas.parse(JSON.parse(texto))
}

export function esClaveBancaria(reglas: Reglas, clave: string): boolean {
  return reglas.claves_bancarias.some((prefijo) => clave.startsWith(prefijo))
}
