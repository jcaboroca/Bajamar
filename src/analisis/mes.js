// @ts-check
/**
 * Cuánto se puede gastar de aquí a una fecha.
 *
 * Este módulo era el que sabía de meses: los partía en dos mitades, los
 * descomponía desde la proyección y decidía a cuál se apuntaba cada cobro. Nada
 * de eso hace falta desde que el mes es el periodo entre dos nóminas: lo que
 * cae entre sus dos bordes es suyo, y de contarlo se encarga `mensual.js`.
 *
 * Lo único que sobrevive es la pregunta que no es de ningún mes: con el saldo
 * de hoy delante, cuánto queda libre hasta una fecha. El saldo del banco ya
 * incorpora todo lo ocurrido, así que se le suma sólo lo que falta por pasar:
 * meter también lo ya cobrado sería contar el mismo euro dos veces.
 */

import { diasEntre } from '../dominio/tipos.js'

/**
 * @typedef {import('./bajamar.js').Evento} Evento
 */

/**
 * @param {object} entrada
 * @param {number} entrada.saldo         lo que dice el banco hoy
 * @param {Evento[]} entrada.eventos
 * @param {number} entrada.ritmoPorDia
 * @param {string} entrada.hoy
 * @param {string} entrada.hasta
 * @param {number} [entrada.reserva]     lo que se aparta para los gastos anuales
 */
export function disponibleReal({ saldo, eventos, ritmoPorDia, hoy, hasta, reserva = 0 }) {
  let porCobrar = 0
  let porPagar = 0
  for (const e of eventos) {
    if (e.fecha <= hoy || e.fecha > hasta) continue
    if (e.importe > 0) porCobrar += e.importe
    else porPagar += e.importe
  }
  const goteo = ritmoPorDia * Math.max(diasEntre(hoy, hasta), 0)
  return {
    saldo,
    porCobrar,
    porPagar,
    goteo,
    reserva: -Math.abs(reserva),
    total: saldo + porCobrar + porPagar + goteo - Math.abs(reserva),
  }
}
