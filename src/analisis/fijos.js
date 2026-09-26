// @ts-check
/**
 * Lo que cuesta existir: los compromisos ordenados por cómo pesan de verdad.
 *
 * Un seguro de 600 € al año no es un gasto de abril. Es 50 € al mes que se
 * cobran de golpe en abril. Las dos cosas son ciertas y la aplicación necesita
 * las dos: el coste mensual equivalente para saber cuánto cuesta tu vida, y el
 * cargo real en su fecha para saber cuándo te quedas sin dinero.
 *
 * Confundirlas es el error clásico. Si sólo miras el equivalente mensual nunca
 * ves venir el golpe; si sólo miras el cargo real, tu gasto mensual parece
 * saltar sin motivo cuatro veces al año.
 */

/**
 * @typedef {import('../dominio/tipos.js').Compromiso} Compromiso
 * @typedef {import('../dominio/tipos.js').Movimiento} Movimiento
 */

/** @type {Record<Compromiso['periodicidad'], number>} */
export const MESES_DE = { mensual: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12 }

/**
 * Por encima de esta dispersión, el importe no se puede dar por sabido. La luz
 * de enero y la de mayo no se parecen, y decir «74,30 €» sería mentir con
 * precisión decimal.
 */
const UMBRAL_VARIABLE = 0.18

/**
 * @typedef {object} Fijo
 * @property {string} entidadId
 * @property {string} nombre
 * @property {Compromiso['periodicidad']} periodicidad
 * @property {number} importeEsperado      céntimos, negativo
 * @property {number} mensualEquivalente   céntimos, negativo
 * @property {number} variacion            0 = clavado; 0.4 = muy cambiante
 * @property {string} proximaPrevista
 * @property {string} categoria
 * @property {boolean} estable
 * @property {Compromiso['estado']} estado
 * @property {boolean} [aplazable] el usuario dice que puede saltárselo un mes
 */

/**
 * @param {Compromiso[]} compromisos
 * @param {Movimiento[]} movimientos
 * @param {Map<string, string>} categorias  entidadId → categoría
 * @returns {Fijo[]}
 */
export function describirFijos(compromisos, movimientos, categorias) {
  /** @type {Map<string, number[]>} */
  const serie = new Map()
  for (const m of movimientos) {
    if (!m.entidadId || m.origen === 'tarjeta') continue
    const lista = serie.get(m.entidadId)
    if (lista) lista.push(m.importe)
    else serie.set(m.entidadId, [m.importe])
  }

  return compromisos.map((c) => {
    // Si el cobrador tiene una sola serie, toda su historia es esa serie y la
    // dispersión es real. Si tiene varias —el ayuntamiento cobra tres recibos
    // distintos— hay que quedarse con los importes que se parecen a este, o la
    // luz saldría «variable» por culpa del agua.
    const conMismoCobrador = compromisos.filter((otro) => otro.entidadId === c.entidadId).length
    const todos = serie.get(c.entidadId) ?? []
    const cercanos = conMismoCobrador === 1
      ? todos
      : todos.filter((v) => Math.abs(v - c.importeEsperado) <= Math.abs(c.importeEsperado) * 0.4)
    const variacion = dispersion(cercanos, c.importeEsperado)
    return {
      entidadId: c.entidadId,
      nombre: c.nombre,
      periodicidad: c.periodicidad,
      importeEsperado: c.importeEsperado,
      mensualEquivalente: Math.round(c.importeEsperado / MESES_DE[c.periodicidad]),
      variacion,
      proximaPrevista: c.proximaPrevista,
      categoria: categorias.get(c.entidadId) ?? 'otros',
      estable: variacion <= UMBRAL_VARIABLE,
      estado: c.estado,
    }
  })
}

/**
 * Desviación típica relativa al importe esperado. Con menos de tres datos no
 * se afirma nada: se devuelve 0 y el compromiso pasa por estable.
 * @param {number[]} valores
 * @param {number} referencia
 */
function dispersion(valores, referencia) {
  if (valores.length < 3 || referencia === 0) return 0
  const media = valores.reduce((t, v) => t + v, 0) / valores.length
  const varianza = valores.reduce((t, v) => t + (v - media) ** 2, 0) / valores.length
  return Math.sqrt(varianza) / Math.abs(referencia)
}

/**
 * @typedef {object} Estructura
 * @property {Fijo[]} mensuales      cada mes y por el mismo importe
 * @property {Fijo[]} variables      cada mes pero nunca lo mismo
 * @property {Fijo[]} periodicos     trimestrales y semestrales
 * @property {Fijo[]} anuales        una vez al año
 * @property {Fijo[]} suscripciones  el goteo que nadie recuerda haber firmado
 * @property {number} costeMensual   lo que cuesta un mes de tu vida, todo incluido
 * @property {number} reservaMensual lo que habría que apartar para los no mensuales
 * @property {number} suscripcionesMes
 * @property {number} suscripcionesAnio
 */

/**
 * Reparte los fijos en los grupos con los que se piensa sobre ellos.
 *
 * Los grupos son excluyentes salvo las suscripciones, que son una lectura
 * transversal: interesan por lo que suman entre todas, no por dónde caen.
 *
 * @param {Fijo[]} fijos
 * @returns {Estructura}
 */
export function estructura(fijos) {
  const gastos = fijos.filter((f) => f.importeEsperado < 0 && f.estado !== 'extinto')
  const mensual = gastos.filter((f) => f.periodicidad === 'mensual')
  const suscripciones = gastos.filter((f) => f.categoria === 'suscripciones')

  const porImporte = (/** @type {Fijo} */ a, /** @type {Fijo} */ b) => a.mensualEquivalente - b.mensualEquivalente
  const sumaEquivalente = (/** @type {Fijo[]} */ lista) => lista.reduce((t, f) => t + f.mensualEquivalente, 0)

  const noMensuales = gastos.filter((f) => f.periodicidad !== 'mensual')

  return {
    mensuales: mensual.filter((f) => f.estable).sort(porImporte),
    variables: mensual.filter((f) => !f.estable).sort(porImporte),
    periodicos: gastos.filter((f) => f.periodicidad === 'bimestral' || f.periodicidad === 'trimestral' || f.periodicidad === 'semestral').sort(porImporte),
    anuales: gastos.filter((f) => f.periodicidad === 'anual').sort(porImporte),
    suscripciones: suscripciones.sort(porImporte),
    costeMensual: sumaEquivalente(gastos),
    reservaMensual: sumaEquivalente(noMensuales),
    suscripcionesMes: sumaEquivalente(suscripciones),
    suscripcionesAnio: sumaEquivalente(suscripciones) * 12,
  }
}
