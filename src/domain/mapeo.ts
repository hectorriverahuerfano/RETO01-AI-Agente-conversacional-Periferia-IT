import type { Glosario, Maestro } from "./fixtures.ts"
import type { Reglas } from "./reglas.ts"

export type EstadoCampo = "lleno" | "faltante" | "requiere_confirmacion"

export interface CampoMapeado {
  etiqueta: string
  estado: EstadoCampo
  ruta?: string
  valor?: string
  confianza: number
  nota?: string
}

export interface Mapeo {
  llenos: CampoMapeado[]
  faltantes: CampoMapeado[]
  requiere_confirmacion: CampoMapeado[]
}

export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function tokens(texto: string, vacias: Set<string>): Set<string> {
  return new Set(normalizar(texto).split(" ").filter((t) => t && !vacias.has(t)))
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let comunes = 0
  for (const t of a) if (b.has(t)) comunes++
  return comunes / (a.size + b.size - comunes)
}

/** Busca la clave del maestro para una etiqueta: exacta (1.0) o por similitud de palabras. */
function resolverClave(etiqueta: string, glosario: Glosario, reglas: Reglas): { clave?: string; confianza: number } {
  const objetivo = normalizar(etiqueta)
  for (const [sinonimo, clave] of Object.entries(glosario)) {
    if (normalizar(sinonimo) === objetivo) return { clave, confianza: 1 }
  }
  const vacias = new Set(reglas.palabras_vacias)
  const tokEtiqueta = tokens(etiqueta, vacias)
  let mejor: { clave?: string; confianza: number } = { confianza: 0 }
  for (const [sinonimo, clave] of Object.entries(glosario)) {
    const puntaje = jaccard(tokEtiqueta, tokens(sinonimo, vacias))
    if (puntaje > mejor.confianza) mejor = { clave, confianza: puntaje }
  }
  return mejor
}

/** Lee un valor por ruta con puntos ("banco.numero_cuenta"). */
export function valorPorRuta(maestro: Maestro, ruta: string): string | undefined {
  let actual: unknown = maestro
  for (const parte of ruta.split(".")) {
    if (typeof actual !== "object" || actual === null) return undefined
    actual = (actual as Record<string, unknown>)[parte]
  }
  if (actual === null || actual === undefined || typeof actual === "object") return undefined
  return String(actual)
}

/** Regla RN1 y HU-1: identificador tributario según el país del cliente. */
function notaIdentificador(etiqueta: string, pais: string, reglas: Reglas): string | undefined {
  const esperado = reglas.identificador_tributario_por_pais[pais]
  if (pais !== reglas.pais_del_maestro) {
    return `Identificador extranjero: el cliente (${pais}) pide ${esperado ?? "su identificador local"}; Periferia solo tiene NIT colombiano.`
  }
  if (esperado && normalizar(etiqueta) !== normalizar(esperado)) {
    return `Etiqueta ambigua: en ${pais} el equivalente es ${esperado}.`
  }
  return undefined
}

function mapearCampo(etiqueta: string, pais: string, maestro: Maestro, glosario: Glosario, reglas: Reglas): CampoMapeado {
  const { clave, confianza } = resolverClave(etiqueta, glosario, reglas)
  const conf = Math.round(confianza * 100) / 100
  if (!clave || confianza < reglas.umbral_confirmacion) {
    return { etiqueta, estado: "faltante", confianza: conf, nota: "No existe en el repositorio maestro." }
  }
  const valor = valorPorRuta(maestro, clave)
  if (valor === undefined) {
    return { etiqueta, estado: "faltante", ruta: clave, confianza: conf, nota: "La clave no tiene valor en el maestro." }
  }
  const base = { etiqueta, ruta: clave, valor, confianza: conf, nota: reglas.notas_por_clave[clave] }
  if (clave === reglas.clave_identificador) {
    const nota = notaIdentificador(etiqueta, pais, reglas)
    if (nota) return { ...base, estado: "requiere_confirmacion", nota }
  }
  if (confianza < reglas.umbral_lleno) {
    return { ...base, estado: "requiere_confirmacion", nota: `Coincidencia aproximada (confianza ${conf}).` }
  }
  return { ...base, estado: "lleno" }
}

export function mapearCampos(etiquetas: string[], pais: string, maestro: Maestro, glosario: Glosario, reglas: Reglas): Mapeo {
  const campos = etiquetas.map((e) => mapearCampo(e, pais, maestro, glosario, reglas))
  return {
    llenos: campos.filter((c) => c.estado === "lleno"),
    faltantes: campos.filter((c) => c.estado === "faltante"),
    requiere_confirmacion: campos.filter((c) => c.estado === "requiere_confirmacion"),
  }
}

/** Valor a escribir en el formulario: los campos por confirmar llevan el valor propuesto (RN1). */
export function valorParaFormulario(mapeo: Mapeo, etiqueta: string): string {
  const campo = [...mapeo.llenos, ...mapeo.requiere_confirmacion].find((c) => c.etiqueta === etiqueta)
  return campo?.valor ?? ""
}
