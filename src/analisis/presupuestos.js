// @ts-check
/**
 * Presupuestos por categoría.
 *
 * Un presupuesto sin histórico detrás es un deseo. Por eso cada categoría se
 * compara siempre con lo que esa persona gasta de verdad: no sirve de nada
 * saber que llevas 240 € en restaurantes si no sabes que tu mes normal son
 * 180 €.
 *
 * La media se calcula sobre meses cerrados. El mes en curso está a medias por
 * definición y arrastraría la referencia hacia abajo cada día 3.
 */

import { mediana } from '../dominio/dinero.js'
import { mesDe } from '../dominio/tipos.js'
import { CATEGORIAS } from '../entidades/semillas.js'

/**
 * @typedef {import('../dominio/tipos.js').Movimiento} Movimiento
 * @typedef {{ id: string, importe: number }} Presupuesto  importe en céntimos, positivo
 */

/**
 * Gasto por categoría y mes, ya descontado lo que no es gasto.
 * @param {Movimiento[]} movimientos
 * @param {Map<string, string>} categorias
 * @param {Set<string>} noEsGasto
 * @returns {Map<string, Map<string, number>>} categoría → mes → céntimos negativos
 */
export function gastoPorCategoriaYMes(movimientos, categorias, noEsGasto) {
  /** @type {Map<string, Map<string, number>>} */
  const tabla = new Map()
  for (const m of movimientos) {
    if (m.importe >= 0 || m.origen === 'tarjeta') continue
    const categoria = (m.entidadId && categorias.get(m.entidadId)) || 'otros'
    if (noEsGasto.has(categoria)) continue
    const meses = tabla.get(categoria) ?? new Map()
    const mes = mesDe(m.fecha)
    meses.set(mes, (meses.get(mes) ?? 0) + m.importe)
    tabla.set(categoria, meses)
  }
  return tabla
}

/**
 * @typedef {object} LineaPresupuesto
 * @property {string} id
 * @property {string} nombre
 * @property {number} presupuesto  céntimos positivos; 0 = sin presupuesto fijado
 * @property {number} gastado      céntimos positivos
 * @property {number} disponible   negativo si hay exceso
 * @property {number} porcentaje   0-999
 * @property {number} habitual     céntimos positivos, mediana de meses cerrados
 * @property {number} desvio       -1 a +n frente a lo habitual; 0.18 = 18% más
 * @property {boolean} propuesto   true si el importe lo ha puesto la aplicación
 */

/**
 * @param {object} entrada
 * @param {Movimiento[]} entrada.movimientos
 * @param {Map<string, string>} entrada.categorias
 * @param {Set<string>} entrada.noEsGasto
 * @param {Record<string, number>} entrada.asignado  categoría → céntimos del plan
 * @param {string} entrada.hoy
 * @param {string} [entrada.mes]  cuál se mira; por defecto, el natural de hoy
 * @returns {LineaPresupuesto[]}
 */
export function revisarPresupuestos({ movimientos, categorias, noEsGasto, asignado = {}, hoy, mes }) {
  const tabla = gastoPorCategoriaYMes(movimientos, categorias, noEsGasto)
  // El mes que se mira y el de hoy no son el mismo cuando miras octubre desde
  // septiembre. Lo gastado es del mes que miras; lo habitual sale de los meses
  // ya cerrados, que es una propiedad de tu historial y no de lo que mires.
  const mirado = mes ?? mesDe(hoy)
  const mesActual = mesDe(hoy)

  // Una categoría que has planificado y en la que todavía no has gastado nada
  // tiene que salir igual: «esperado 200, real 0» es información, y esconderla
  // hasta el primer cargo haría aparecer líneas solas a mitad de mes.
  for (const id of Object.keys(asignado)) {
    if (!tabla.has(id)) tabla.set(id, new Map())
  }

  /** @type {LineaPresupuesto[]} */
  const lineas = []
  for (const [id, meses] of tabla) {
    const cerrados = [...meses.entries()]
      .filter(([mes]) => mes < mesActual)
      .map(([, v]) => Math.abs(v))
    // Con un solo mes cerrado no hay costumbre que medir, sólo una anécdota.
    const habitual = cerrados.length >= 2 ? mediana(cerrados) : 0
    const fijado = asignado[id]
    const presupuesto = fijado ?? habitual
    const gastado = Math.abs(meses.get(mirado) ?? 0)

    lineas.push({
      id,
      nombre: CATEGORIAS[id] ?? id,
      presupuesto,
      gastado,
      disponible: presupuesto - gastado,
      porcentaje: presupuesto > 0 ? Math.min(Math.round((gastado / presupuesto) * 100), 999) : 0,
      habitual,
      desvio: habitual > 0 ? (gastado - habitual) / habitual : 0,
      propuesto: fijado === undefined,
    })
  }

  // Delante, lo que está más apretado: un presupuesto sólo sirve si ves el que
  // estás a punto de romper sin tener que buscarlo.
  return lineas.sort((a, b) => b.porcentaje - a.porcentaje || b.gastado - a.gastado)
}
