// @ts-check
/**
 * Lo que aplazas no desaparece: vuelve en tres cuotas.
 *
 * El banco lo cuenta en dos sitios y ninguno de los dos lo dice entero. En la
 * cuenta aparece un abono «FRACCIONAMIENTO …» por el importe completo, que te
 * devuelve lo que ya te había cobrado. En el extracto de la tarjeta aparece la
 * cuota de este mes. Las dos cuotas que faltan no están escritas en ninguna
 * parte, y son exactamente las que hunden los dos meses siguientes.
 *
 * Aplazar se siente como que el gasto se ha ido. Aquí se ve que sigue ahí.
 */

import { sumarMeses, ultimoDiaDelMes } from '../dominio/tipos.js'

/** El banco fracciona a tres meses. */
export const PLAZOS = 3

const ES_FRACCIONAMIENTO = /^FRACCIONAMIENTO\b/i

/**
 * @typedef {object} Cuota
 * @property {string} fecha
 * @property {number} importe  negativo: sale de la cuenta
 * @property {string} nombre
 * @property {number} plazo    1, 2 o 3
 * @property {number} total    lo que aplazaste entero
 */

/**
 * Las cuotas que todavía no te han cobrado.
 *
 * @param {import('../dominio/tipos.js').Movimiento[]} movimientos
 * @param {string} desde  hasta aquí ya está cobrado; sólo cuenta lo de después
 * @returns {Cuota[]}
 */
export function cuotasPendientes(movimientos, desde) {
  /** @type {Cuota[]} */
  const cuotas = []
  for (const m of movimientos) {
    if (m.origen !== 'cuenta' || m.importe <= 0) continue
    if (!ES_FRACCIONAMIENTO.test(m.conceptoRaw ?? '')) continue
    const cuota = Math.round(m.importe / PLAZOS)
    const nombre = nombreDelPlazo(m.conceptoRaw ?? '')
    for (let plazo = 1; plazo <= PLAZOS; plazo += 1) {
      // Se cobran con la liquidación de la tarjeta, a fin de mes.
      const fecha = ultimoDiaDelMes(sumarMeses(`${m.fecha.slice(0, 8)}01`, plazo - 1))
      if (fecha <= desde) continue
      // El redondeo se lo come la última: tres de 110,33 no suman 331.
      const importe = plazo === PLAZOS ? m.importe - cuota * (PLAZOS - 1) : cuota
      cuotas.push({ fecha, importe: -importe, nombre, plazo, total: m.importe })
    }
  }
  return cuotas.sort((a, b) => a.fecha.localeCompare(b.fecha))
}

/** @param {string} concepto */
function nombreDelPlazo(concepto) {
  const limpio = concepto
    .replace(ES_FRACCIONAMIENTO, '')
    .replace(/^\s*(COMPRA\s+TARJ\.?|PAGO\s+DE|TRANSFERENCIA\s+A)\s*/i, '')
    .trim()
  return limpio === '' ? 'Pago aplazado' : limpio
}
