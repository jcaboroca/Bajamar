// @ts-check
/**
 * Cada periodo, contado entero.
 *
 * Un periodo va de una nómina a la siguiente (ver `periodos.js`), así que aquí
 * no hay nada que desplazar ni que reasignar: lo que cae entre sus dos bordes
 * es suyo y ya está. Todo lo que antes necesitaba saber «¿de qué mes es este
 * cobro?» ahora es una comparación de fechas.
 *
 * De cada periodo hay una parte vivida y otra por vivir, y no se presentan con
 * el mismo aplomo. Lo vivido sale del extracto; lo que falta, de la previsión.
 * Y lo previsto no se calcula por su cuenta en ninguna parte: es el total menos
 * lo real, para que las dos mitades no puedan contradecir al total.
 */

import { diasEntre } from '../dominio/tipos.js'

/**
 * @typedef {import('./bajamar.js').Proyeccion} Proyeccion
 * @typedef {import('./periodos.js').Periodo} Periodo
 * @typedef {import('../dominio/tipos.js').Movimiento} Movimiento
 */

/**
 * @typedef {object} Reparto
 * @property {number} real      lo que ya ha pasado
 * @property {number} previsto  lo que falta, que es el total menos lo real
 * @property {number} total
 */

/**
 * @typedef {object} Punto
 * @property {string} fecha
 * @property {number} saldo
 */

/**
 * @typedef {object} Detalle
 * @property {string} id
 * @property {string} desde
 * @property {string} hasta
 * @property {boolean} completo
 * @property {boolean} natural
 * @property {'cerrado' | 'enCurso' | 'futuro'} estado
 * @property {number} dias
 * @property {Reparto} ingresos
 * @property {Reparto} gastos        en negativo
 * @property {number} ahorro
 * @property {{ fecha: string, saldo: number }} suelo
 * @property {Punto[]} curva
 * @property {number} apertura       con cuánto se entra
 * @property {number} saldoFinal
 * @property {number} compromisos    lo que sale con fecha: recibos, cuotas, traspasos
 * @property {number} diaADia        lo que se decide cada mañana, real más previsto
 * @property {number} diaADiaGastado lo que de eso ya se ha ido
 * @property {Movimiento[]} movimientos  los apuntes reales del periodo
 */

/**
 * @param {object} entrada
 * @param {Periodo[]} entrada.periodos
 * @param {Movimiento[]} entrada.movimientos  los de cuenta, con saldo
 * @param {Proyeccion} entrada.proyeccion     la larga
 * @param {Set<string>} entrada.ordinarios    ids de los apuntes que son día a día
 * @param {string} entrada.hoy
 * @returns {Detalle[]}
 */
export function detallarPeriodos({ periodos, movimientos, proyeccion, ordinarios, hoy }) {
  const orden = [...movimientos].sort((a, b) => a.fecha.localeCompare(b.fecha))
  const saldoPrevisto = new Map(proyeccion.curva.map((p) => [p.fecha, p.saldo]))
  const gotaPorDia = new Map(proyeccion.curva.map((p) => [p.fecha, p.gota]))

  return periodos.map((periodo) => {
    const dentro = orden.filter((m) => m.fecha >= periodo.desde && m.fecha <= periodo.hasta)

    /*
     * Un euro que sale de la cuenta cuenta, sea lo que sea. Antes este cálculo
     * dejaba fuera los traspasos y los gastos de banco porque «no son gasto»,
     * y como la curva sí los ve, las dos cifras no podían cuadrar nunca: la
     * resta daba una cosa y el saldo otra.
     *
     * Lo único que se separa es en dos montones: lo que sale con fecha —los
     * recibos, las cuotas, los seguros, el traspaso a la inversión— y lo que
     * se decide cada mañana.
     */
    let entra = 0
    let conFecha = 0
    let diaADia = 0
    for (const m of dentro) {
      // Las compras de la tarjeta ya están en su extracto; lo que cuenta aquí
      // es el cargo con el que el banco las liquida.
      if (m.origen === 'tarjeta') continue
      // El abono de un fraccionamiento no es un ingreso. El banco te devuelve
      // lo que acaba de cobrarte para volver a cobrártelo en tres cuotas, así
      // que va con lo que tiene fecha: ahí se compensa con la liquidación de
      // la tarjeta que deshace, y las dos cuotas que faltan las pone la
      // previsión. Contarlo como ingreso hinchaba la nómina del mes.
      if (m.fraccionado) conFecha += m.importe
      else if (m.importe > 0) entra += m.importe
      else if (ordinarios.has(m.id)) diaADia += m.importe
      else conFecha += m.importe
    }

    const futuros = proyeccion.eventos.filter(
      (e) => e.fecha > hoy && e.fecha >= periodo.desde && e.fecha <= periodo.hasta,
    )
    const entraPrevisto = suma(futuros, (i) => i > 0)
    const conFechaPrevisto = suma(futuros, (i) => i < 0)

    const { curva, apertura } = curvaEntre({ periodo, ordenados: orden, saldoPrevisto, hoy })
    let goteoPrevisto = 0
    for (const p of curva) if (p.fecha > hoy) goteoPrevisto += gotaPorDia.get(p.fecha) ?? 0

    const ingresos = repartir(entra + entraPrevisto, entra)
    const compromisos = conFecha + conFechaPrevisto
    const gastos = repartir(compromisos + diaADia + goteoPrevisto, conFecha + diaADia)

    return {
      id: periodo.id,
      desde: periodo.desde,
      hasta: periodo.hasta,
      completo: periodo.completo,
      natural: periodo.natural,
      estado: periodo.hasta < hoy ? 'cerrado' : periodo.desde > hoy ? 'futuro' : 'enCurso',
      dias: diasEntre(periodo.desde, periodo.hasta) + 1,
      ingresos,
      gastos,
      ahorro: ingresos.total + gastos.total,
      curva,
      suelo: curva.reduce(
        (bajo, p) => (p.saldo < bajo.saldo ? { fecha: p.fecha, saldo: p.saldo } : bajo),
        { fecha: curva[0]?.fecha ?? periodo.desde, saldo: curva[0]?.saldo ?? 0 },
      ),
      apertura,
      saldoFinal: curva[curva.length - 1]?.saldo ?? 0,
      compromisos,
      diaADia: diaADia + goteoPrevisto,
      diaADiaGastado: diaADia,
      movimientos: dentro,
    }
  })
}

/**
 * La curva de un periodo, día a día, de su primer día a su último.
 *
 * Los días vividos salen del extracto —cada apunte trae el saldo que dejó, y
 * un día sin movimientos arrastra el del anterior—; los que faltan, de la
 * previsión. La gráfica empezaba en hoy y por eso «la bajamar de septiembre»
 * acababa siendo el mínimo de los tres días que quedaban de septiembre.
 *
 * @param {object} entrada
 * @param {Periodo} entrada.periodo
 * @param {Movimiento[]} entrada.ordenados
 * @param {Map<string, number>} entrada.saldoPrevisto
 * @param {string} entrada.hoy
 * @returns {{ curva: Punto[], apertura: number }}
 */
function curvaEntre({ periodo, ordenados, saldoPrevisto, hoy }) {
  let arrastre = 0
  /** @type {Map<string, number>} */
  const realPorDia = new Map()
  for (const m of ordenados) {
    if (m.saldo === null || m.saldo === undefined) continue
    if (m.fecha < periodo.desde) arrastre = m.saldo
    else if (m.fecha <= periodo.hasta) realPorDia.set(m.fecha, m.saldo)
  }
  /*
   * Con cuánto se entra es lo que había ANTES del primer día, no el saldo de
   * ese día. Un periodo empieza el día que entra la nómina, y el saldo de ese
   * día ya la lleva dentro: tomarlo como apertura la contaba dos veces, una
   * en «empiezas con» y otra en «lo que entra».
   */
  const apertura = arrastre

  /** @type {Punto[]} */
  const curva = []
  for (let fecha = periodo.desde; fecha <= periodo.hasta; fecha = siguienteDia(fecha)) {
    arrastre = (fecha <= hoy ? realPorDia.get(fecha) : saldoPrevisto.get(fecha)) ?? arrastre
    curva.push({ fecha, saldo: arrastre })
  }
  return { curva, apertura }
}

/**
 * Lo previsto es lo que falta, no una cuenta aparte. Calcularlo por su cuenta
 * abriría la puerta a que las dos mitades no dieran el total, y entonces habría
 * que explicar cuál de las tres cifras es la buena.
 * @param {number} total
 * @param {number} real
 * @returns {Reparto}
 */
function repartir(total, real) {
  return { real, previsto: total - real, total }
}

/**
 * @param {Array<{ importe: number }>} lista
 * @param {(importe: number) => boolean} filtro
 */
function suma(lista, filtro) {
  return lista.reduce((t, x) => (filtro(x.importe) ? t + x.importe : t), 0)
}

/** @param {string} iso */
function siguienteDia(iso) {
  const [a, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(a, m - 1, d + 1))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}

/**
 * Lo que queda para el día a día: saldo al empezar, más lo que entra, menos
 * todo lo que sale con fecha.
 *
 * Es la fórmula entera, sin filtros por categoría. Si un traspaso a la
 * inversión sale de la cuenta, resta: que no sea «gasto» no lo devuelve. Ésa
 * era la razón de que esta cifra y el saldo no cuadrasen nunca.
 *
 * @param {Detalle} periodo
 * @param {number} [colchon]
 */
export function residuoDe(periodo, colchon = 0) {
  return periodo.apertura + periodo.ingresos.total + periodo.compromisos - Math.abs(colchon)
}
