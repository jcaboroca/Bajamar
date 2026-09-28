// @ts-check
/**
 * El mes, contado en dos mitades que no se pueden mezclar.
 *
 * De cualquier mes hay una parte que ya ha ocurrido y otra que todavía no. La
 * primera es un hecho y la segunda una previsión, y la aplicación no debe
 * presentarlas con el mismo aplomo. Aquí se calculan por separado y se suman
 * al final, para que la interfaz pueda enseñar las dos.
 *
 * El saldo del banco ya incorpora todo lo ocurrido. Por eso el dinero
 * realmente disponible se obtiene sumándole sólo lo que falta por pasar: meter
 * también lo ya cobrado sería contar el mismo euro dos veces.
 */

import { diasEntre, mesDe, ultimoDiaDelMes } from '../dominio/tipos.js'
import { mesContableDe } from './cascada.js'

/**
 * @typedef {import('../dominio/tipos.js').Movimiento} Movimiento
 * @typedef {import('./bajamar.js').Evento} Evento
 * @typedef {import('./bajamar.js').Proyeccion} Proyeccion
 */

/**
 * @typedef {object} Mitad
 * @property {number} real       lo que ya ha pasado, en céntimos
 * @property {number} previsto   lo que falta por pasar
 * @property {number} total
 */

/**
 * @typedef {object} ResumenMes
 * @property {string} mes            "2026-09"
 * @property {Mitad} ingresos
 * @property {Mitad} gastos          en negativo
 * @property {number} ahorro         ingresos + gastos
 * @property {number} apartado       lo movido a cuentas propias de ahorro
 * @property {number} movimientos    cuántos apuntes reales lleva el mes
 */

/**
 * @param {object} entrada
 * @param {Movimiento[]} entrada.movimientos
 * @param {Map<string, string>} entrada.categorias
 * @param {Set<string>} entrada.noEsGasto
 * @param {Evento[]} entrada.eventos
 * @param {string} entrada.mes
 * @param {string} entrada.hoy
 * @param {Set<string>} [entrada.ingresosRecurrentes] entidadId de los cobros que vuelven
 * @returns {ResumenMes}
 */
export function resumenDeMes({ movimientos, categorias, noEsGasto, eventos, mes, hoy, ingresosRecurrentes }) {
  let ingresoReal = 0
  let gastoReal = 0
  let apartado = 0
  let cuantos = 0

  for (const m of movimientos) {
    // La tarjeta se cuenta el día que el banco la liquida, no el día de cada
    // compra: si no, el mismo dinero aparece dos veces.
    if (m.origen === 'tarjeta') continue
    const categoria = (m.entidadId && categorias.get(m.entidadId)) || 'otros'
    // Una nómina cobrada el 25 ya es el dinero del mes que viene, igual que en
    // la previsión. Los demás cobros —una devolución, un Bizum— se quedan en el
    // mes natural en que entraron.
    //
    // Se reconoce de dos maneras a propósito. Por categoría, que es lo directo
    // cuando la nómina está identificada; y porque sea un ingreso que se
    // repite, que es el mismo criterio con el que se desplazan los eventos
    // previstos. Con sólo lo primero, una nómina que la aplicación no ha
    // sabido etiquetar dejaba el mes siguiente a cero sin decir por qué.
    const abreMes = categoria === 'nomina'
      || (m.importe > 0 && !!m.entidadId && ingresosRecurrentes?.has(m.entidadId) === true)
    if (mesContableDe(m.fecha, abreMes) !== mes) continue
    cuantos += 1
    if (categoria === 'traspaso') {
      if (m.importe < 0) apartado += m.importe
      continue
    }
    if (m.importe > 0) ingresoReal += m.importe
    else if (!noEsGasto.has(categoria)) gastoReal += m.importe
  }

  let ingresoPrevisto = 0
  let gastoPrevisto = 0
  for (const e of eventos) {
    if (mesContable(e) !== mes || e.fecha <= hoy) continue
    if (e.importe > 0) ingresoPrevisto += e.importe
    else gastoPrevisto += e.importe
  }

  // El gasto del día a día no tiene fecha: es un goteo. Se reparte por los
  // días del mes que aún no han llegado.
  const ingresos = mitad(ingresoReal, ingresoPrevisto)
  const gastos = mitad(gastoReal, gastoPrevisto)

  return {
    mes,
    ingresos,
    gastos,
    ahorro: ingresos.total + gastos.total,
    apartado,
    movimientos: cuantos,
  }
}

/**
 * @param {number} real
 * @param {number} previsto
 * @returns {Mitad}
 */
function mitad(real, previsto) {
  return { real, previsto, total: real + previsto }
}

/**
 * Añade al resumen el goteo del gasto ordinario que queda por venir.
 * @param {ResumenMes} resumen
 * @param {number} ritmoPorDia   céntimos negativos
 * @param {string} hoy
 * @returns {ResumenMes}
 */
export function conGotaDiaria(resumen, ritmoPorDia, hoy) {
  const fin = ultimoDiaDelMes(`${resumen.mes}-01`)
  const desde = hoy > `${resumen.mes}-01` ? hoy : `${resumen.mes}-01`
  const dias = Math.max(diasEntre(desde, fin), 0)
  const goteo = ritmoPorDia * dias
  const gastos = mitad(resumen.gastos.real, resumen.gastos.previsto + goteo)
  return { ...resumen, gastos, ahorro: resumen.ingresos.total + gastos.total }
}

/**
 * Dinero del que se puede disponer de verdad hasta una fecha.
 *
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

/**
 * @typedef {object} FilaMes
 * @property {string} mes
 * @property {number} ingresos
 * @property {number} gastos
 * @property {number} ahorro
 * @property {{ fecha: string, saldo: number }} suelo
 * @property {number} saldoFinal
 */

/**
 * En qué mes cuenta un evento. Los gastos, en el suyo. Los ingresos de final de
 * mes, en el que abren.
 *
 * Esto no mueve el dinero: en la cuenta sigue entrando el 25 y el suelo se
 * calcula con esa fecha. Sólo cambia a qué mes se le apunta.
 *
 * La regla vive en cascada.js, que es de donde sale el concepto de mes.
 *
 * @param {import('./bajamar.js').Evento} evento
 */
export function mesContable(evento) {
  return mesContableDe(evento.fecha, evento.tipo === 'ingreso')
}

/**
 * Descompone una proyección larga en meses.
 *
 * Es la vista que contesta «¿y en marzo?». Cada mes se cierra con su propio
 * suelo, porque un mes puede acabar bien y aun así haber pasado por un
 * descubierto el día 12.
 *
 * @param {Proyeccion} proyeccion
 * @returns {FilaMes[]}
 */
export function porMeses(proyeccion) {
  /** @type {Map<string, FilaMes>} */
  const filas = new Map()

  for (const punto of proyeccion.curva) {
    const mes = mesDe(punto.fecha)
    const fila = filas.get(mes)
    if (!fila) {
      filas.set(mes, {
        mes,
        ingresos: 0,
        gastos: 0,
        ahorro: 0,
        suelo: { ...punto },
        saldoFinal: punto.saldo,
      })
      continue
    }
    if (punto.saldo < fila.suelo.saldo) fila.suelo = { ...punto }
    fila.saldoFinal = punto.saldo
  }

  // Cada día aporta lo que de verdad goteó ese día: el goteo puede cambiar a lo
  // largo del horizonte, porque el plan sólo manda dentro de su mes.
  for (const punto of proyeccion.curva) {
    const fila = filas.get(mesDe(punto.fecha))
    if (fila) fila.gastos += punto.gota
  }

  for (const e of proyeccion.eventos) {
    const fila = filas.get(mesContable(e))
    if (!fila) continue
    if (e.importe > 0) fila.ingresos += e.importe
    else fila.gastos += e.importe
  }

  for (const fila of filas.values()) fila.ahorro = fila.ingresos + fila.gastos
  return [...filas.values()]
}
