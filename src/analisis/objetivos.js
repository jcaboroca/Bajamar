// @ts-check
/**
 * Cuánto puedo ahorrar y cuándo llego.
 *
 * La capacidad de ahorro no es «ingresos menos gastos del mes pasado». Ese
 * número sube y baja según toque o no el seguro del coche, y por eso no sirve
 * para decidir nada. Aquí se resta lo que se repite —fijos, goteo diario— y
 * además la parte proporcional de lo que sólo se paga una vez al año. Lo que
 * queda es dinero que puedes comprometer sin que te explote un recibo en
 * marzo.
 */

import { sumarMeses } from '../dominio/tipos.js'

/**
 * @typedef {object} Objetivo
 * @property {string} id
 * @property {string} nombre
 * @property {number} meta        céntimos positivos
 * @property {number} ahorrado    céntimos positivos
 * @property {number} aportacion  céntimos positivos al mes; 0 = sin plan
 * @property {string} [fechaMeta] ISO; si está, manda sobre la aportación
 */

/**
 * @typedef {object} Reparto
 * @property {number} ingresos
 * @property {number} fijos       negativo
 * @property {number} ordinario   negativo
 * @property {number} reserva     negativo
 * @property {number} capacidad
 */

/**
 * @param {object} entrada
 * @param {number} entrada.ingresos   céntimos positivos al mes
 * @param {number} entrada.fijos      céntimos negativos al mes (equivalente mensual)
 * @param {number} entrada.ordinario  céntimos negativos al mes
 * @param {number} entrada.reserva    céntimos negativos al mes
 * @returns {Reparto}
 */
export function capacidadDeAhorro({ ingresos, fijos, ordinario, reserva }) {
  // Los fijos ya incluyen la parte proporcional de los anuales: si además se
  // restara la reserva entera, los anuales contarían dos veces.
  const fijosMensuales = -Math.abs(fijos) + Math.abs(reserva)
  return {
    ingresos,
    fijos: fijosMensuales,
    ordinario: -Math.abs(ordinario),
    reserva: -Math.abs(reserva),
    capacidad: ingresos + fijosMensuales - Math.abs(ordinario) - Math.abs(reserva),
  }
}

/**
 * @typedef {object} Progreso
 * @property {number} faltan        céntimos
 * @property {number} porcentaje    0-100
 * @property {number} meses         los que quedan al ritmo actual; Infinity si no hay ritmo
 * @property {string} [fechaLlegada] ISO
 * @property {number} aportacionNecesaria  para llegar a la fecha pedida
 * @property {boolean} alcanzable   false si hay fecha y el ritmo no da
 */

/**
 * @param {Objetivo} objetivo
 * @param {string} hoy
 * @returns {Progreso}
 */
export function progresoDe(objetivo, hoy) {
  const faltan = Math.max(objetivo.meta - objetivo.ahorrado, 0)
  const porcentaje = objetivo.meta > 0
    ? Math.min(Math.round((objetivo.ahorrado / objetivo.meta) * 100), 100)
    : 0

  const mesesHastaFecha = objetivo.fechaMeta ? mesesEntre(hoy, objetivo.fechaMeta) : 0
  const aportacionNecesaria = mesesHastaFecha > 0 ? Math.ceil(faltan / mesesHastaFecha) : faltan

  if (faltan === 0) {
    return { faltan: 0, porcentaje: 100, meses: 0, fechaLlegada: hoy, aportacionNecesaria: 0, alcanzable: true }
  }

  if (objetivo.aportacion <= 0) {
    return { faltan, porcentaje, meses: Infinity, aportacionNecesaria, alcanzable: false }
  }

  const meses = Math.ceil(faltan / objetivo.aportacion)
  return {
    faltan,
    porcentaje,
    meses,
    fechaLlegada: sumarMeses(hoy, meses),
    aportacionNecesaria,
    alcanzable: mesesHastaFecha === 0 || meses <= mesesHastaFecha,
  }
}

/**
 * @param {string} a ISO
 * @param {string} b ISO
 */
function mesesEntre(a, b) {
  const [aa, am] = a.split('-').map(Number)
  const [ba, bm] = b.split('-').map(Number)
  return Math.max((ba * 12 + bm) - (aa * 12 + am), 0)
}
