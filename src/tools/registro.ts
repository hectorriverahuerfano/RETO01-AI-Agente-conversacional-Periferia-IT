import { z } from "zod"
import * as proveedor from "./proveedor.ts"
import type { ContextoHerramienta } from "./tipos.ts"

// Registro único de herramientas: nombre visible = <archivo>_<export>.

export interface HerramientaRegistrada {
  nombre: string
  descripcion: string
  esquema: z.ZodObject
  parametros: Record<string, unknown>
  ejecutar(args: unknown, ctx: ContextoHerramienta): Promise<string>
}

interface Definicion {
  description: string
  args: Record<string, z.ZodType>
  execute(args: never, ctx: ContextoHerramienta): Promise<string>
}

function registrar(archivo: string, modulo: Record<string, Definicion>): HerramientaRegistrada[] {
  return Object.entries(modulo).map(([exportName, def]) => {
    const esquema = z.object(def.args)
    return {
      nombre: `${archivo}_${exportName}`,
      descripcion: def.description,
      esquema,
      parametros: z.toJSONSchema(esquema) as Record<string, unknown>,
      async ejecutar(args: unknown, ctx: ContextoHerramienta): Promise<string> {
        // El backend valida antes de ejecutar y devuelve el error al modelo si no cumple.
        const r = esquema.safeParse(args ?? {})
        if (!r.success) {
          const detalle = r.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ")
          return JSON.stringify({ ok: false, error: `argumentos inválidos: ${detalle}` })
        }
        return (def.execute as (a: unknown, c: ContextoHerramienta) => Promise<string>)(r.data, ctx)
      },
    }
  })
}

export const herramientas: HerramientaRegistrada[] = registrar("proveedor", proveedor as unknown as Record<string, Definicion>)

export function buscarHerramienta(nombre: string): HerramientaRegistrada | undefined {
  return herramientas.find((h) => h.nombre === nombre)
}
