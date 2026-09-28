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
 * @property {{ entra: Apunte[], conFecha: Apunte[], diaADia: Apunte[] }} desglose
 */

/**
 * Una línea del desglose: de dónde sale cada euro de los totales.
 *
 * @typedef {object} Apunte
 * @property {string} fecha
 * @property {number} importe
 * @property {string} concepto
 * @property {string | null} entidadId  para poder ponerle el nombre bueno
 * @property {string | null} reciboId   de qué recibo viene, si viene de uno
 * @property {boolean} aplazable        el usuario dice que un mes malo se lo salta
 * @property {boolean} previsto         todavía no ha pasado
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
  const cierres = cierresPorDia(orden)
  const saldoPrevisto = new Map(proyeccion.curva.map((p) => [p.fecha, p.saldo]))
  const desdePrevisto = proyeccion.desde
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
    /** @type {{ entra: Apunte[], conFecha: Apunte[], diaADia: Apunte[] }} */
    const desglose = { entra: [], conFecha: [], diaADia: [] }
    /** @param {'entra'|'conFecha'|'diaADia'} donde @param {any} m @param {boolean} previsto */
    const anotar = (donde, m, previsto) => desglose[donde].push({
      fecha: m.fecha,
      importe: m.importe,
      concepto: m.nombre ?? m.conceptoRaw ?? '',
      entidadId: m.entidadId ?? null,
      reciboId: m.reciboId ?? null,
      aplazable: m.aplazable === true,
      previsto,
    })

    for (const m of dentro) {
      // Las compras de la tarjeta ya están en su extracto; lo que cuenta aquí
      // es el cargo con el que el banco las liquida.
      if (m.origen === 'tarjeta') continue
      if (m.importe > 0) { entra += m.importe; anotar('entra', m, false) }
      // La cuota de un fraccionamiento no se decide cada mañana: tiene fecha
      // y el banco la cobra la haya uno pedido o no.
      else if (m.fraccionado) { conFecha += m.importe; anotar('conFecha', m, false) }
      else if (ordinarios.has(m.id)) { diaADia += m.importe; anotar('diaADia', m, false) }
      else { conFecha += m.importe; anotar('conFecha', m, false) }
    }

    /*
     * La frontera entre lo real y lo previsto la pone la proyección, no el
     * calendario. Un recibo que vence hoy y todavía no ha llegado al extracto
     * es previsión para ella, y filtrar aquí por «después de hoy» lo dejaba
     * fuera de la cuenta mientras la curva sí lo bajaba: la resta y el
     * gráfico acababan diciendo cosas distintas.
     */
    const futuros = proyeccion.eventos.filter(
      (e) => e.fecha >= periodo.desde && e.fecha <= periodo.hasta,
    )
    const entraPrevisto = suma(futuros, (i) => i > 0)
    const conFechaPrevisto = suma(futuros, (i) => i < 0)
    for (const e of futuros) anotar(e.importe > 0 ? 'entra' : 'conFecha', e, true)
    for (const lista of Object.values(desglose)) {
      lista.sort((a, b) => a.fecha.localeCompare(b.fecha))
    }

    const { curva, apertura } = curvaEntre({ periodo, cierres, saldoPrevisto, desdePrevisto })
    let goteoPrevisto = 0
    for (const p of curva) if (p.fecha > desdePrevisto) goteoPrevisto += gotaPorDia.get(p.fecha) ?? 0

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
      desglose,
    }
  })
}

/**
 * Con qué saldo se cierra un día.
 *
 * Dentro de un mismo día el extracto no viene en orden, así que el último de
 * la lista no es el último del día. Pero cada apunte trae el saldo que dejó, y
 * eso basta para encadenarlos: el saldo de cierre es el único que no es el
 * saldo de partida de ningún otro apunte de ese día.
 *
 * @param {Movimiento[]} delDia
 * @param {number | null} alAbrir  con cuánto empezó el día, si se sabe
 * @returns {number | null}  null si ese día no trae ningún saldo
 */
function saldoAlCerrar(delDia, alAbrir) {
  const conSaldo = delDia.filter((m) => m.saldo !== null && m.saldo !== undefined)
  if (conSaldo.length === 0) return null
  const departida = new Set(conSaldo.map((m) => (m.saldo ?? 0) - m.importe))
  const cierres = conSaldo.filter((m) => !departida.has(m.saldo ?? 0))
  if (cierres.length === 1) return cierres[0].saldo ?? null
  /*
   * Un cargo y su devolución el mismo día dejan dos apuntes con el mismo
   * saldo: la cadena se muerde la cola y no queda ninguno suelto. Cuando pasa
   * eso, la cuenta se hace sola —lo que había al abrir más todo lo del día—,
   * que es más fiable que fiarse del orden del fichero.
   */
  if (alAbrir !== null) return conSaldo.reduce((total, m) => total + m.importe, alAbrir)
  return conSaldo[conSaldo.length - 1].saldo ?? null
}

/**
 * Con cuánto cerró cada día del extracto.
 *
 * Se recorre de principio a fin porque el cierre de un día es la apertura del
 * siguiente, y eso es lo que permite desatascar los días en que la cadena de
 * saldos no tiene principio ni final.
 *
 * @param {Movimiento[]} movimientos
 * @returns {Map<string, number>}
 */
export function cierresPorDia(movimientos) {
  /** @type {Map<string, Movimiento[]>} */
  const porDia = new Map()
  for (const m of movimientos) {
    const delDia = porDia.get(m.fecha)
    if (delDia === undefined) porDia.set(m.fecha, [m])
    else delDia.push(m)
  }

  /** @type {Map<string, number>} */
  const cierres = new Map()
  /** @type {number | null} */
  let anterior = null
  for (const fecha of [...porDia.keys()].sort()) {
    const cierre = saldoAlCerrar(porDia.get(fecha) ?? [], anterior)
    if (cierre === null) continue
    cierres.set(fecha, cierre)
    anterior = cierre
  }
  return cierres
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
 * @param {Map<string, number>} entrada.cierres  con cuánto cerró cada día vivido
 * @param {Map<string, number>} entrada.saldoPrevisto
 * @param {string} entrada.desdePrevisto  primer día que ya no sale del extracto
 * @returns {{ curva: Punto[], apertura: number }}
 */
function curvaEntre({ periodo, cierres, saldoPrevisto, desdePrevisto }) {
  let arrastre = 0
  /** @type {Map<string, number>} */
  const realPorDia = new Map()
  for (const [fecha, cierre] of cierres) {
    if (fecha < periodo.desde) arrastre = cierre
    else if (fecha <= periodo.hasta) realPorDia.set(fecha, cierre)
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
    arrastre = (fecha < desdePrevisto ? realPorDia.get(fecha) : saldoPrevisto.get(fecha)) ?? arrastre
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
