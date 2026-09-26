// @ts-check
/**
 * Agrupa los nombres limpios en entidades.
 *
 * Dos mecanismos distintos porque los problemas son distintos:
 *
 * - Las PERSONAS las anonimiza el propio banco, y cambió de formato a mitad
 *   de la serie: "CARMEN AMPARO BENITEZ LARA" pasó a "CARMEN B L" y luego a
 *   "CARMEN B. L.". Eso sí tiene regla: coincide el nombre de pila y las
 *   iniciales restantes son subsecuencia de las del nombre largo.
 * - Los COMERCIOS no tienen regla. "AMZN MKTP ES" y "WWW.AMAZON" son lo mismo
 *   y ningún algoritmo lo deduce. Van por tabla.
 */

import { normalizar } from './limpiar.js'
import { SEMILLAS } from './semillas.js'

/** @typedef {import('../dominio/tipos.js').Entidad} Entidad */

/** @param {string} nombre */
function tokens(nombre) {
  return normalizar(nombre).replace(/\./g, '').split(' ').filter((t) => t.length > 0)
}

/** @param {string[]} t */
function esAbreviado(t) {
  return t.length > 1 && t.slice(1).every((x) => x.length === 1)
}

/**
 * @param {string[]} iniciales
 * @param {string[]} de
 */
function esSubsecuencia(iniciales, de) {
  let i = 0
  for (const letra of de) {
    if (i < iniciales.length && letra === iniciales[i]) i += 1
  }
  return i === iniciales.length
}

/**
 * ¿Son el mismo ser humano escrito de dos formas por el banco?
 * @param {string} a
 * @param {string} b
 */
export function mismaPersona(a, b) {
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.length === 0 || tb.length === 0) return false
  if (ta[0] !== tb[0]) return false

  const abreviadoA = esAbreviado(ta)
  const abreviadoB = esAbreviado(tb)

  // El banco cambió de formato dos veces: "CARMEN B L" y "CARMEN B. L." son la
  // misma anotación con distinta puntuación, y ninguna de las dos es la forma
  // larga. Sin esto quedarían como dos personas separadas.
  if (abreviadoA && abreviadoB) {
    return ta.length === tb.length && ta.every((x, i) => x === tb[i])
  }
  // Para lo demás hace falta exactamente una forma abreviada y una completa.
  if (abreviadoA === abreviadoB) return false

  const corto = abreviadoA ? ta : tb
  const largo = abreviadoA ? tb : ta
  return esSubsecuencia(
    corto.slice(1),
    largo.slice(1).map((t) => t[0]),
  )
}

/** @param {string} nombre */
export function idDesde(nombre) {
  return normalizar(nombre)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'sin-nombre'
}

/**
 * @param {string[]} nombres
 * @returns {{ entidades: Entidad[], categorias: Map<string, string> }}
 */
export function reconciliar(nombres) {
  const unicos = [...new Set(nombres.filter((n) => n.length > 0))]
  /** @type {Entidad[]} */
  const entidades = []
  /** @type {Map<string, string>} */
  const categorias = new Map()
  /** @type {Set<string>} */
  const usados = new Set()

  for (const semilla of SEMILLAS) {
    const alias = unicos.filter((n) => !usados.has(n) && semilla.patron.test(n))
    if (alias.length === 0) continue
    alias.forEach((n) => usados.add(n))
    const id = idDesde(semilla.nombre)
    entidades.push({ id, nombre: semilla.nombre, alias, tipo: semilla.tipo })
    categorias.set(id, semilla.categoria)
  }

  for (const nombre of unicos) {
    if (usados.has(nombre)) continue
    const grupo = unicos.filter((otro) => !usados.has(otro) && (otro === nombre || mismaPersona(nombre, otro)))
    grupo.forEach((n) => usados.add(n))
    // El nombre completo manda sobre el abreviado: tiene más información.
    const canonico = grupo.reduce((a, b) => (tokens(b).join('').length > tokens(a).join('').length ? b : a))
    const esPersona = grupo.length > 1
    const id = idDesde(canonico)
    entidades.push({ id, nombre: canonico, alias: grupo, tipo: esPersona ? 'persona' : 'comercio' })
    categorias.set(id, esPersona ? 'personas' : 'otros')
  }

  return { entidades, categorias }
}

/**
 * Índice de alias a identificador de entidad.
 * @param {Entidad[]} entidades
 */
export function indicePorAlias(entidades) {
  /** @type {Map<string, string>} */
  const indice = new Map()
  for (const e of entidades) {
    for (const a of e.alias) indice.set(a, e.id)
  }
  return indice
}
