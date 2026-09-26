// @ts-check
/**
 * Todo lo que el usuario decide, guardado aparte de los extractos.
 *
 * La separación importa: un extracto se reimporta y se sobrescribe entero,
 * pero una categoría corregida a mano o un objetivo de ahorro tienen que
 * sobrevivir a eso. Por eso no se tocan los movimientos para guardar nada de
 * esto.
 */

import { borrar, escribir, leer, leerTodo } from './db.js'

/**
 * @typedef {import('../dominio/tipos.js').Retoque} Retoque
 * @typedef {import('../analisis/presupuestos.js').Presupuesto} Presupuesto
 * @typedef {import('../analisis/objetivos.js').Objetivo} Objetivo
 * @typedef {import('../analisis/patrimonio.js').Apunte} Apunte
 */

/**
 * @typedef {'fijo' | 'suelto' | 'baja'} Trato
 */

/**
 * @typedef {object} Preferencias
 * @property {Retoque[]} retoques
 * @property {Presupuesto[]} presupuestos
 * @property {Objetivo[]} objetivos
 * @property {Apunte[]} patrimonio
 * @property {Record<string, string>} reglas   entidadId → categoría
 * @property {Record<string, Trato>} tratos    entidadId → cómo tratarlo al prever
 * @property {import('../dominio/tipos.js').Bulto[]} bultos
 * @property {number} colchon                  céntimos
 */

/** @returns {Promise<Preferencias>} */
export async function cargar() {
  const [retoques, presupuestos, objetivos, patrimonio, reglas, bultos, colchon, tratos] = await Promise.all([
    leerTodo('retoques'),
    leerTodo('presupuestos'),
    leerTodo('objetivos'),
    leerTodo('patrimonio'),
    leerTodo('reglas'),
    leerTodo('bultos'),
    leer('ajustes', 'colchon'),
    leer('ajustes', 'tratos'),
  ])

  return {
    retoques,
    presupuestos,
    objetivos,
    patrimonio,
    bultos,
    reglas: Object.fromEntries(reglas.map((/** @type {any} */ r) => [r.id, r.categoria])),
    tratos: /** @type {any} */ (tratos)?.valor ?? {},
    colchon: Number(/** @type {any} */ (colchon)?.valor ?? 0),
  }
}

/**
 * Guarda un retoque, o lo borra si ya no dice nada.
 *
 * Un retoque vacío no es lo mismo que no tenerlo sólo en apariencia: dejarlo
 * ahí obligaría a comprobar campo por campo en cada cálculo.
 * @param {Retoque} retoque
 */
export async function ponerRetoque(retoque) {
  const vacio = retoque.categoria === undefined
    && retoque.excluido !== true
    && retoque.traspaso !== true
    && !retoque.nota
  if (vacio) return borrar('retoques', retoque.id)
  return escribir('retoques', { ...retoque })
}

/**
 * @param {string} entidadId
 * @param {string | null} categoria  null borra la regla
 */
export async function ponerRegla(entidadId, categoria) {
  if (!categoria) return borrar('reglas', entidadId)
  return escribir('reglas', { id: entidadId, categoria })
}

/**
 * @param {string} categoria
 * @param {number | null} importe  céntimos positivos; null vuelve a lo propuesto
 */
export async function ponerPresupuesto(categoria, importe) {
  if (importe === null) return borrar('presupuestos', categoria)
  return escribir('presupuestos', { id: categoria, importe: Math.abs(importe) })
}

/** @param {Objetivo} objetivo */
export async function ponerObjetivo(objetivo) {
  return escribir('objetivos', { ...objetivo })
}

/** @param {string} id */
export async function quitarObjetivo(id) {
  return borrar('objetivos', id)
}

/** @param {Apunte} apunte */
export async function ponerApunte(apunte) {
  return escribir('patrimonio', { ...apunte })
}

/** @param {string} id */
export async function quitarApunte(id) {
  return borrar('patrimonio', id)
}

/** @param {number} centimos */
export async function ponerColchon(centimos) {
  return escribir('ajustes', { id: 'colchon', valor: Math.abs(centimos) })
}

/**
 * Cambia cómo se trata un compromiso al prever. Van todos en un solo registro
 * porque siempre se leen juntos y nunca son muchos.
 * @param {string} entidadId
 * @param {Trato | null} trato  null lo devuelve a fijo
 */
export async function ponerTrato(entidadId, trato) {
  const guardado = /** @type {any} */ (await leer('ajustes', 'tratos'))
  const valor = { ...(guardado?.valor ?? {}) }
  if (trato === null || trato === 'fijo') delete valor[entidadId]
  else valor[entidadId] = trato
  return escribir('ajustes', { id: 'tratos', valor })
}

/** Identificador corto y único para lo que crea el usuario. */
export function nuevoId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}
