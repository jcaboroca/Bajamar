// @ts-check
/**
 * El resumen, mes a mes.
 *
 * «Este mes» no quería decir lo mismo en toda la aplicación. En el resumen era
 * el mes natural y en la cascada el que paga la última nómina, así que un día
 * 28 una pantalla hablaba de septiembre y la otra de octubre sin avisar. La
 * salida no es elegir uno: es dejar de decir «este mes» y decir el nombre del
 * mes, y que se pueda pasar de uno a otro.
 *
 * Cada mes se cuenta entero, del día 1 al último, y sabe en qué estado está:
 * cerrado es historia, en curso es mitad hecho y mitad previsto, y futuro es
 * previsión entera hasta que cargues el extracto que lo convierta en real.
 *
 * Los totales salen de la proyección, que es la única que sabe sumar goteo y
 * eventos en el orden correcto. Lo real sale del extracto. Y lo previsto no se
 * calcula por su cuenta: es la resta de los dos, para que no puedan
 * contradecirse.
 */

import { mesDe, ultimoDiaDelMes } from '../dominio/tipos.js'

/**
 * @typedef {import('./bajamar.js').Proyeccion} Proyeccion
 * @typedef {import('./mes.js').FilaMes} FilaMes
 * @typedef {import('./mes.js').ResumenMes} ResumenMes
 */

/**
 * @typedef {object} Reparto
 * @property {number} real      lo que ya ha pasado
 * @property {number} previsto  lo que falta, que es el total menos lo real
 * @property {number} total
 */

/**
 * @typedef {'cerrado' | 'enCurso' | 'futuro'} Estado
 */

/**
 * @typedef {object} MesDetallado
 * @property {string} mes            'yyyy-mm'
 * @property {Estado} estado
 * @property {Reparto} ingresos
 * @property {Reparto} gastos        en negativo
 * @property {number} ahorro         ingresos.total + gastos.total
 * @property {{ fecha: string, saldo: number }} suelo
 * @property {number} apertura       con cuánto se entra en el mes
 * @property {number} saldoFinal
 * @property {number} goteo          la parte del gasto que es día a día
 * @property {number} compromisos    el resto: recibos, cuotas, lo que toca
 */

/**
 * @param {object} entrada
 * @param {FilaMes[]} entrada.meses            de porMeses, ya con sus totales
 * @param {Proyeccion} entrada.proyeccion      la larga, de donde sale la curva
 * @param {(mes: string) => ResumenMes} entrada.resumenDe  lo real de un mes
 * @param {string} entrada.hoy
 * @returns {MesDetallado[]}
 */
export function detallarMeses({ meses, proyeccion, resumenDe, hoy }) {
  const enCurso = mesDe(hoy)
  const goteos = goteoPorMes(proyeccion)
  const aperturas = aperturaPorMes(proyeccion)

  return meses.map((fila) => {
    const real = resumenDe(fila.mes)
    const goteo = goteos.get(fila.mes) ?? 0
    return {
      mes: fila.mes,
      estado: fila.mes < enCurso ? 'cerrado' : fila.mes === enCurso ? 'enCurso' : 'futuro',
      ingresos: repartir(fila.ingresos, real.ingresos.real),
      gastos: repartir(fila.gastos, real.gastos.real),
      ahorro: fila.ahorro,
      suelo: fila.suelo,
      apertura: aperturas.get(fila.mes) ?? proyeccion.saldoInicial,
      saldoFinal: fila.saldoFinal,
      goteo,
      compromisos: fila.gastos - goteo,
    }
  })
}

/**
 * Lo previsto es lo que falta, no una cuenta aparte.
 *
 * Calcularlo por su cuenta abriría la puerta a que la suma de las dos mitades
 * no diera el total, y entonces habría que explicar cuál de las tres cifras es
 * la buena.
 *
 * @param {number} total
 * @param {number} real
 * @returns {Reparto}
 */
function repartir(total, real) {
  return { real, previsto: total - real, total }
}

/**
 * Cuánto goteó cada mes, sumando lo que de verdad se aplicó cada día.
 * @param {Proyeccion} proyeccion
 */
function goteoPorMes(proyeccion) {
  /** @type {Map<string, number>} */
  const porMes = new Map()
  for (const punto of proyeccion.curva) {
    const mes = mesDe(punto.fecha)
    porMes.set(mes, (porMes.get(mes) ?? 0) + punto.gota)
  }
  return porMes
}

/**
 * Con cuánto se entra en cada mes: el saldo del último día del anterior.
 *
 * El primero de la proyección no empieza el día 1 sino hoy, así que su apertura
 * es el saldo de hoy. Decir otra cosa sería inventarse un pasado que la
 * proyección no ha recorrido.
 *
 * @param {Proyeccion} proyeccion
 */
function aperturaPorMes(proyeccion) {
  /** @type {Map<string, number>} */
  const porMes = new Map()
  let anterior = null
  for (const punto of proyeccion.curva) {
    const mes = mesDe(punto.fecha)
    // Con cuánto se entra es con lo que se cerró el día anterior, no con el
    // saldo del día 1: ese ya lleva aplicado lo que pasó ese mismo día.
    if (!porMes.has(mes)) porMes.set(mes, anterior === null ? punto.saldo : anterior.saldo)
    anterior = punto
  }
  return porMes
}

/**
 * Lo que queda para el día a día de un mes entero: lo que cobras menos lo que
 * ya está comprometido.
 *
 * Con cuánto entras al mes no se suma aquí a propósito, aunque se enseñe al
 * lado. Sumarlo diría que puedes gastarte los ahorros este mes, y con doce mil
 * euros en la cuenta la cifra saldría siendo doce mil: cierta y para nada útil.
 * Es la misma cuenta que hace la cascada, y tiene que dar lo mismo o habría dos
 * respuestas a «cuánto me queda para vivir este mes».
 *
 * Para el mes en curso no sirve: ahí se cuenta desde hoy, porque lo de antes ya
 * está gastado y vive dentro del saldo.
 *
 * @param {MesDetallado} mes
 * @param {number} [colchon]  céntimos que no quieres tocar
 */
export function residuoDe(mes, colchon = 0) {
  return mes.ingresos.total + mes.compromisos - Math.abs(colchon)
}

/** El último día de un mes, para saber si ya se ha cerrado. */
export function estaAcabado(mes, hoy) {
  return hoy >= ultimoDiaDelMes(`${mes}-01`)
}
