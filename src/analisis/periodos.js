// @ts-check
/**
 * El mes, que no es el mes.
 *
 * Un mes natural no describe la vida de nadie. Si cobras el 25, el 1 no empieza
 * nada: llevas seis días viviendo del dinero que entró. Lo que empieza algo es
 * la nómina, y lo que lo acaba es la siguiente.
 *
 * Así que aquí el mes es el periodo entre dos nóminas. Septiembre va del 25 de
 * agosto al 24 de septiembre, y se llama septiembre porque es donde acaba. El
 * día en que entra el dinero pertenece al periodo que abre, no al que cierra:
 * los periodos encajan sin solaparse y sin dejar un día fuera.
 *
 * Antes esto se apañaba con un desplazamiento —el mes seguía siendo del 1 al 30
 * y los cobros de final de mes se apuntaban al siguiente—, y costaba tres
 * conceptos, una segunda línea en la gráfica y diez días al mes con dos meses
 * vivos a la vez. Nada de eso hace falta cuando la definición es la correcta.
 */

import { mesDe, sumarMeses, ultimoDiaDelMes } from '../dominio/tipos.js'

/**
 * @typedef {object} Periodo
 * @property {string} id        'yyyy-mm', el mes en que acaba
 * @property {string} desde     el día en que entró la nómina que lo paga
 * @property {string} hasta     el día antes de la siguiente, incluido
 * @property {boolean} completo false si le falta el principio o el final
 * @property {boolean} natural  true si no hay nómina y se cuenta por meses
 */

/**
 * Los periodos que cubren un tramo de tiempo.
 *
 * Los cortes son las fechas en que entra la nómina: las reales del extracto
 * para lo ya vivido y las previstas para lo que viene. Fuera de esta función
 * no hay que saber de dónde salen.
 *
 * @param {object} entrada
 * @param {string[]} entrada.cortes  fechas de nómina, en cualquier orden
 * @param {string} entrada.desde     primer día que hay que cubrir
 * @param {string} entrada.hasta     último día que hay que cubrir
 * @returns {Periodo[]}
 */
export function periodosEntre({ cortes, desde, hasta }) {
  const limpios = [...new Set(cortes)].filter((f) => f <= hasta).sort()
  if (limpios.length === 0) return mesesNaturales(desde, hasta)

  /** @type {Periodo[]} */
  const periodos = []

  // Lo que hay antes de la primera nómina también se vivió, pero no se sabe
  // con qué dinero: su nómina es anterior al extracto. Sale marcado.
  if (desde < limpios[0]) {
    periodos.push(armar(desde, anterior(limpios[0]), false))
  }

  for (let i = 0; i < limpios.length; i += 1) {
    const inicio = limpios[i]
    const siguiente = limpios[i + 1]
    // El último periodo no tiene cierre todavía: se extiende hasta donde
    // llegue la previsión, y por eso tampoco está completo.
    const fin = siguiente ? anterior(siguiente) : hasta
    if (fin < inicio) continue
    periodos.push(armar(inicio, fin, siguiente !== undefined))
  }

  return sinIdsRepetidos(periodos)
}

/**
 * Sin nómina reconocida no hay periodo de nómina. Fingir uno sería peor que
 * contar por meses naturales y decirlo.
 *
 * @param {string} desde
 * @param {string} hasta
 * @returns {Periodo[]}
 */
function mesesNaturales(desde, hasta) {
  /** @type {Periodo[]} */
  const periodos = []
  let mes = mesDe(desde)
  while (mes <= mesDe(hasta)) {
    const primero = `${mes}-01`
    const ultimo = ultimoDiaDelMes(primero)
    periodos.push({
      id: mes,
      desde: primero < desde ? desde : primero,
      hasta: ultimo > hasta ? hasta : ultimo,
      completo: primero >= desde && ultimo <= hasta,
      natural: true,
    })
    mes = sumarMeses(primero, 1).slice(0, 7)
  }
  return periodos
}

/**
 * @param {string} desde
 * @param {string} hasta
 * @param {boolean} completo
 * @returns {Periodo}
 */
function armar(desde, hasta, completo) {
  // Se llama como el mes en que acaba. Es el que más días aporta y el que
  // tiene uno en la cabeza cuando dice «septiembre».
  return { id: mesDe(hasta), desde, hasta, completo, natural: false }
}

/**
 * Dos periodos pueden acabar en el mismo mes si la nómina se mueve mucho —el 1
 * y el 30 del mismo mes—. Que compartan identidad haría que un plan guardado
 * para uno apareciera en el otro.
 * @param {Periodo[]} periodos
 */
function sinIdsRepetidos(periodos) {
  const vistos = new Set()
  return periodos.map((p) => {
    let id = p.id
    while (vistos.has(id)) id += 'b'
    vistos.add(id)
    return id === p.id ? p : { ...p, id }
  })
}

/** @param {string} iso */
function anterior(iso) {
  const [a, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(a, m - 1, d - 1))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}

/**
 * Las fechas en que corta la nómina: las ya cobradas y las que vienen.
 *
 * Una paga extra no corta. Cortar por cualquier cobro de la misma entidad
 * partiría junio en dos y dejaría un «periodo» de cuatro días, así que cuando
 * caen dos en el mismo mes manda la primera, que es la que sigue el ritmo.
 *
 * @param {object} entrada
 * @param {Array<{ fecha: string }>} entrada.cobradas  nóminas del extracto
 * @param {Array<{ fecha: string }>} entrada.previstas nóminas de la previsión
 * @returns {string[]}
 */
export function cortesDeNomina({ cobradas, previstas }) {
  /** @type {Map<string, string>} */
  const porMes = new Map()
  for (const { fecha } of [...cobradas, ...previstas].sort((a, b) => a.fecha.localeCompare(b.fecha))) {
    const mes = mesDe(fecha)
    if (!porMes.has(mes)) porMes.set(mes, fecha)
  }
  return [...porMes.values()].sort()
}

/**
 * El periodo en el que cae un día.
 * @param {Periodo[]} periodos
 * @param {string} fecha
 */
export function periodoDe(periodos, fecha) {
  return periodos.find((p) => fecha >= p.desde && fecha <= p.hasta) ?? null
}

/**
 * Cómo se lee un periodo cuando no es el mes entero: «del 25 de agosto al 24
 * de septiembre». Sin esto, un periodo de 28 días llamado septiembre parece un
 * error de la aplicación.
 * @param {Periodo} periodo
 */
export function diasQueDura(periodo) {
  const [a1, m1, d1] = periodo.desde.split('-').map(Number)
  const [a2, m2, d2] = periodo.hasta.split('-').map(Number)
  const ms = Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)
  return Math.round(ms / 86_400_000) + 1
}
