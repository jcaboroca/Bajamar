// @ts-check
/**
 * Lo repartido contra lo gastado, categoría a categoría.
 *
 * Un presupuesto sin histórico detrás es un deseo. Por eso cada categoría se
 * compara siempre con lo que esa persona gasta de verdad: no sirve de nada
 * saber que llevas 240 € en restaurantes si no sabes que tu mes normal son
 * 180 €.
 *
 * Lo habitual se mide sobre periodos cerrados. El que está en curso está a
 * medias por definición y arrastraría la referencia hacia abajo cada día 3.
 * Y los periodos son de nómina a nómina, no meses naturales: medir la
 * costumbre sobre un corte distinto del que se usa para gastar daría una
 * referencia que no se parece a nada.
 */

import { mediana } from '../dominio/dinero.js'
import { CATEGORIAS } from '../entidades/semillas.js'

/**
 * @typedef {import('./mensual.js').Detalle} Detalle
 * @typedef {{ id: string, importe: number }} Presupuesto  céntimos, positivo
 */

/**
 * @typedef {object} LineaPresupuesto
 * @property {string} id
 * @property {string} nombre
 * @property {number} presupuesto  céntimos positivos; 0 = sin repartir
 * @property {number} gastado      céntimos positivos
 * @property {number} disponible   negativo si hay exceso
 * @property {number} porcentaje   0-999
 * @property {number} habitual     céntimos positivos, mediana de periodos cerrados
 * @property {number} desvio       -1 a +n frente a lo habitual; 0.18 = 18% más
 * @property {boolean} propuesto   true si el importe no lo has puesto tú
 */

/**
 * Lo gastado por categoría dentro de un periodo.
 * @param {Detalle} periodo
 * @param {Set<string>} noEsGasto
 * @returns {Map<string, number>} categoría → céntimos positivos
 */
export function gastoPorCategoria(periodo, noEsGasto) {
  /** @type {Map<string, number>} */
  const total = new Map()
  for (const m of periodo.movimientos) {
    if (m.importe >= 0 || m.origen === 'tarjeta') continue
    const categoria = m.categoria ?? 'otros'
    if (noEsGasto.has(categoria)) continue
    total.set(categoria, (total.get(categoria) ?? 0) + Math.abs(m.importe))
  }
  return total
}

/**
 * @param {object} entrada
 * @param {Detalle[]} entrada.periodos             todos, para medir la costumbre
 * @param {Detalle} entrada.periodo                el que se mira
 * @param {Set<string>} entrada.noEsGasto
 * @param {Record<string, number>} [entrada.asignado] categoría → céntimos del plan
 * @returns {LineaPresupuesto[]}
 */
export function revisarPresupuestos({ periodos, periodo, noEsGasto, asignado = {} }) {
  // Sólo los cerrados, y sólo los completos: uno al que le falta el principio
  // por ser el primero del extracto diría que ese mes gastaste la mitad.
  const cerrados = periodos.filter((p) => p.estado === 'cerrado' && p.completo)
  /** @type {Map<string, number[]>} */
  const historia = new Map()
  for (const p of cerrados) {
    for (const [categoria, importe] of gastoPorCategoria(p, noEsGasto)) {
      historia.set(categoria, [...(historia.get(categoria) ?? []), importe])
    }
  }

  const gastado = gastoPorCategoria(periodo, noEsGasto)
  // Una categoría que has repartido y en la que aún no has gastado tiene que
  // salir igual: «esperado 200, real 0» es información.
  const todas = new Set([...historia.keys(), ...gastado.keys(), ...Object.keys(asignado)])

  /** @type {LineaPresupuesto[]} */
  const lineas = []
  for (const id of todas) {
    const vistos = historia.get(id) ?? []
    // Con un solo periodo cerrado no hay costumbre que medir, sólo una anécdota.
    const habitual = vistos.length >= 2 ? mediana(vistos) : 0
    const fijado = asignado[id]
    const presupuesto = fijado ?? habitual
    const cuanto = gastado.get(id) ?? 0

    lineas.push({
      id,
      nombre: CATEGORIAS[id] ?? id,
      presupuesto,
      gastado: cuanto,
      disponible: presupuesto - cuanto,
      porcentaje: presupuesto > 0 ? Math.min(Math.round((cuanto / presupuesto) * 100), 999) : 0,
      habitual,
      desvio: habitual > 0 ? (cuanto - habitual) / habitual : 0,
      propuesto: fijado === undefined,
    })
  }

  // Delante, lo que está más apretado: un presupuesto sólo sirve si ves el que
  // estás a punto de romper sin tener que buscarlo.
  return lineas.sort((a, b) => b.porcentaje - a.porcentaje || b.gastado - a.gastado)
}
