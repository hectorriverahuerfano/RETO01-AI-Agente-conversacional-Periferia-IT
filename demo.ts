// Verificación sin modelo: ejecuta las herramientas directamente sobre todos los casos.
// Uso: npm run demo  (o: bun run demo.ts)

process.env.FECHA_EJECUCION ??= "2026-09-25"

import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { otorgarConfirmacion } from "./src/domain/confirmaciones.ts"
import * as proveedor from "./src/tools/proveedor.ts"
import { buscarHerramienta } from "./src/tools/registro.ts"
import * as moduloTools from "./modulo/tools/proveedor.ts"
import { contenidoModulo } from "./scripts/sync-modulo.ts"

const raiz = path.dirname(fileURLToPath(import.meta.url))
const ctx = { directory: raiz, sessionId: "demo" }

interface Campo { etiqueta: string; nota?: string }
interface Resp<T> { ok: boolean; error: string; data: T }
type Solicitud = { campos: string[]; formato: string; resumen: string }
type MapeoR = { llenos: Campo[]; faltantes: Campo[]; requiere_confirmacion: Campo[]; resumen: string }
type Formulario = { soportado: boolean; resumen: string }
type Paquete = { listo_para_firma: boolean; resumen: string; checklist: { problema_formulario?: string } }
type Log = { ts?: string; herramienta?: string; ok?: boolean; resumen?: string }
let fallos = 0

function verificar(condicion: boolean, descripcion: string): void {
  console.log(`  ${condicion ? "✔" : "✘"} ${descripcion}`)
  if (!condicion) fallos++
}

function parse<T = unknown>(s: string): Resp<T> {
  return JSON.parse(s) as Resp<T>
}

const esperado: Record<string, { llenos: number; faltantes: number; confirmar: number; listo: boolean; formato: string }> = {
  "co-industrias-delta": { llenos: 17, faltantes: 0, confirmar: 0, listo: true, formato: "xlsx" },
  "ec-corp-andina": { llenos: 13, faltantes: 1, confirmar: 1, listo: false, formato: "pdf" },
  "hn-agroexport-sula": { llenos: 9, faltantes: 1, confirmar: 1, listo: false, formato: "xlsx" },
  "pa-logistica-istmo": { llenos: 8, faltantes: 0, confirmar: 1, listo: true, formato: "portal" },
}

async function procesarCaso(caso: string): Promise<void> {
  console.log(`\n■ ${caso}`)
  const sol = parse<Solicitud>(await proveedor.leer_solicitud.execute({ caso }, ctx))
  if (!sol.ok) return console.log(`  error: ${sol.error}`)
  const map = parse<MapeoR>(await proveedor.mapear_campos.execute({ caso, campos: sol.data.campos }, ctx))
  const gen = parse<Formulario>(await proveedor.generar_formulario.execute({ caso, mapeo: [] }, ctx))
  const paq = parse<Paquete>(await proveedor.armar_paquete.execute({ caso }, ctx))
  console.log(`  ${sol.data.resumen}`)
  console.log(`  mapeo: ${map.data.resumen}`)
  console.log(`  formulario: ${gen.ok ? gen.data.resumen : gen.error}`)
  console.log(`  paquete: ${paq.data.resumen}`)
  for (const c of map.data.faltantes) console.log(`    faltante: ${c.etiqueta}`)
  for (const c of map.data.requiere_confirmacion) console.log(`    por confirmar: ${c.etiqueta} — ${c.nota}`)

  const e = esperado[caso]
  if (!e) return
  verificar(sol.data.formato === e.formato, `formato ${e.formato}`)
  verificar(map.data.llenos.length === e.llenos && map.data.faltantes.length === e.faltantes && map.data.requiere_confirmacion.length === e.confirmar,
    `conteos ${e.llenos}/${e.faltantes}/${e.confirmar}`)
  verificar(paq.data.listo_para_firma === e.listo, `listo_para_firma = ${e.listo}`)
  const borrador = await readFile(path.join(raiz, "out", caso, "paquete", "borrador-correo.md"), "utf8")
  verificar(!borrador.includes("03100012345") && !/COLOCOBM|Bancolombia/.test(borrador), "RN2: borrador sin datos bancarios")
  if (e.formato === "portal") verificar(gen.data.soportado === false, "portal: formato no soportado + valores-portal.md")
}

async function pruebasDeError(): Promise<void> {
  console.log("\n■ Manejo de errores (HU-5)")
  const inexistente = parse(await proveedor.leer_solicitud.execute({ caso: "no-existe" }, ctx))
  verificar(!inexistente.ok && /no existe/.test(inexistente.error), `caso inexistente → "${inexistente.error}"`)

  const traversal = parse(await buscarHerramienta("proveedor_leer_solicitud")!.ejecutar({ caso: "../../etc" }, ctx))
  verificar(!traversal.ok && /argumentos inválidos/.test(traversal.error), "path traversal rechazado por zod")

  const sinConfirmar = parse(await proveedor.simular_envio.execute({ caso: "ec-corp-andina", confirmado: true }, ctx))
  verificar(!sinConfirmar.ok && sinConfirmar.error === "requiere confirmación explícita", "envío sin confirmación humana rechazado aunque confirmado=true")

  otorgarConfirmacion("demo", "ec-corp-andina")
  const confirmado = parse(await proveedor.simular_envio.execute({ caso: "ec-corp-andina", confirmado: true }, ctx))
  verificar(confirmado.ok, "envío con confirmación → ENVIO-SIMULADO.md")
  const repetido = parse(await proveedor.simular_envio.execute({ caso: "ec-corp-andina", confirmado: true }, ctx))
  verificar(!repetido.ok, "la confirmación es de un solo uso")

  // Plantilla corrupta: se prueba sobre una copia temporal para no tocar fixtures.
  const tmp = await mkdtemp(path.join(os.tmpdir(), "reto01-"))
  try {
    await cp(path.join(raiz, "fixtures"), path.join(tmp, "fixtures"), { recursive: true })
    await cp(path.join(raiz, "src", "knowledge"), path.join(tmp, "src", "knowledge"), { recursive: true })
    await writeFile(path.join(tmp, "fixtures", "reto-01", "casos", "hn-agroexport-sula", "plantilla-celdas.json"), "{ esto no es json")
    const ctxTmp = { directory: tmp, sessionId: "demo" }
    const corrupta = parse(await proveedor.mapear_campos.execute({ caso: "hn-agroexport-sula", campos: [] }, ctxTmp))
    verificar(!corrupta.ok && /corrupto/.test(corrupta.error) && !/at \w+ \(/.test(corrupta.error), `plantilla corrupta → "${corrupta.error}"`)
    const paquete = parse<Paquete>(await proveedor.armar_paquete.execute({ caso: "hn-agroexport-sula" }, ctxTmp))
    verificar(paquete.ok && paquete.data.listo_para_firma === false && Boolean(paquete.data.checklist.problema_formulario),
      "con plantilla corrupta el paquete y el checklist se generan igual")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  await rm(path.join(raiz, "out"), { recursive: true, force: true })
  console.log(`Demo sin modelo · FECHA_EJECUCION=${process.env.FECHA_EJECUCION}`)
  const casos = (await readdir(path.join(raiz, "fixtures", "reto-01", "casos"))).sort()
  for (const caso of casos) await procesarCaso(caso)
  await pruebasDeError()
  console.log("\n■ Módulo reutilizable (bonus)")
  for (const [relativa, esperadoTxt] of Object.entries(await contenidoModulo())) {
    const actual = await readFile(path.join(raiz, relativa), "utf8").catch(() => "")
    verificar(actual === esperadoTxt, `${relativa} sincronizado con su fuente`)
  }
  verificar(moduloTools.leer_solicitud === proveedor.leer_solicitud, "modulo/tools/proveedor.ts reexporta las mismas herramientas")
  const log = (await readFile(path.join(raiz, "out", "log.jsonl"), "utf8")).trim().split("\n")
  verificar(log.length > 0 && log.every((l) => { const j = JSON.parse(l) as Log; return Boolean(j.ts && j.herramienta && typeof j.ok === "boolean" && j.resumen) }), `out/log.jsonl con ${log.length} entradas {ts, herramienta, ok, resumen}`)
  console.log(fallos === 0 ? "\n✅ Todas las verificaciones pasaron." : `\n❌ ${fallos} verificaciones fallaron.`)
  process.exitCode = fallos === 0 ? 0 : 1
}

void main()
