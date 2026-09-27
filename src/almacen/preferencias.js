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
 * @property {Record<string, Trato>} tratos    reciboId → cómo preverlo
 * @property {Record<string, string>} apodos   reciboId → cómo lo llama el usuario
 * @property {Record<string, true>} unicos     entidadId → no va a repetirse
 * @property {Record<string, true>} anuales    entidadId → vuelve cada año
 * @property {import('../dominio/tipos.js').Bulto[]} bultos
 * @property {number} colchon                  céntimos
 */

/** @returns {Promise<Preferencias>} */
export async function cargar() {
  const [retoques, presupuestos, objetivos, patrimonio, reglas, bultos, colchon, tratos, apodos, unicos, anuales] = await Promise.all([
    leerTodo('retoques'),
    leerTodo('presupuestos'),
    leerTodo('objetivos'),
    leerTodo('patrimonio'),
    leerTodo('reglas'),
    leerTodo('bultos'),
    leer('ajustes', 'colchon'),
    leerTodo('tratos'),
    leerTodo('apodos'),
    leerTodo('unicos'),
    leerTodo('anuales'),
  ])

  return {
    retoques,
    presupuestos,
    objetivos,
    patrimonio,
    bultos,
    reglas: Object.fromEntries(reglas.map((/** @type {any} */ r) => [r.id, r.categoria])),
    tratos: Object.fromEntries(tratos.map((/** @type {any} */ t) => [t.id, t.trato])),
    apodos: Object.fromEntries(apodos.map((/** @type {any} */ a) => [a.id, a.nombre])),
    unicos: Object.fromEntries(unicos.map((/** @type {any} */ u) => [u.id, true])),
    anuales: Object.fromEntries(anuales.map((/** @type {any} */ a) => [a.id, true])),
    colchon: Number(/** @type {any} */ (colchon)?.valor ?? 0),
  }
}

/**
 * Las primeras respuestas se guardaron todas en un mismo registro. Se reparten
 * en cuanto se abre la app, y el registro viejo se retira para no leerlo dos
 * veces ni dejar dos verdades sobre lo mismo.
 */
export async function repartirTratosViejos() {
  const guardado = /** @type {any} */ (await leer('ajustes', 'tratos'))
  if (!guardado?.valor) return
  for (const [reciboId, trato] of Object.entries(guardado.valor)) {
    if (trato === 'suelto' || trato === 'baja') await escribir('tratos', { id: reciboId, trato })
  }
  await borrar('ajustes', 'tratos')
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
 * La batería solar se compra una vez. Sigue estando en el historial y en el
 * saldo de aquel mes, pero no tiene por qué seguir saliendo del de los que
 * vienen.
 * @param {string} entidadId
 * @param {boolean} esUnico
 */
export async function ponerUnico(entidadId, esUnico) {
  if (!esUnico) return borrar('unicos', entidadId)
  return escribir('unicos', { id: entidadId })
}

/**
 * El seguro del coche visto una sola vez es indistinguible de un pago único, y
 * la app no puede saberlo. El usuario sí.
 * @param {string} entidadId
 * @param {boolean} esAnual
 */
export async function ponerAnual(entidadId, esAnual) {
  if (!esAnual) return borrar('anuales', entidadId)
  return escribir('anuales', { id: entidadId })
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
 * Cambia cómo se trata un recibo al prever.
 *
 * Cada respuesta se guarda por separado y no en un bulto común: si viajaran
 * todas juntas, contestar en el móvil borraría lo contestado en el portátil
 * sólo por ser más reciente el bulto entero.
 * @param {string} reciboId
 * @param {Trato | null} trato  null lo devuelve a fijo
 */
export async function ponerTrato(reciboId, trato) {
  if (trato === null || trato === 'fijo') return borrar('tratos', reciboId)
  return escribir('tratos', { id: reciboId, trato })
}

/**
 * Cómo se llama un recibo. El banco pone «PayPal» a dos suscripciones
 * distintas y a cien compras; el nombre de verdad sólo lo sabe quien paga.
 * @param {string} reciboId
 * @param {string} nombre  vacío lo devuelve al del banco
 */
export async function ponerApodo(reciboId, nombre) {
  const limpio = nombre.trim()
  if (limpio === '') return borrar('apodos', reciboId)
  return escribir('apodos', { id: reciboId, nombre: limpio.slice(0, 40) })
}

/** Identificador corto y único para lo que crea el usuario. */
export function nuevoId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}
