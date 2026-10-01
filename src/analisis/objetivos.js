// @ts-check
/**
 * Cuánto puedo ahorrar.
 *
 * La capacidad de ahorro no es «ingresos menos gastos del mes pasado». Ese
 * número sube y baja según toque o no el seguro del coche, y por eso no sirve
 * para decidir nada. Aquí se resta lo que se repite —fijos, goteo diario— y
 * además la parte proporcional de lo que sólo se paga una vez al año. Lo que
 * queda es dinero que puedes comprometer sin que te explote un recibo en
 * marzo.
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
