// @ts-check
/**
 * El plan del mes: en qué has decidido tú que se va el día a día.
 *
 * Hasta aquí el goteo diario era una medida —la mediana de lo que gastaste— y
 * la previsión se hacía suponiendo que el mes que viene serás el mismo de
 * siempre. Eso contesta «qué pasará si sigo así», que es una pregunta útil una
 * vez. Después la pregunta es la otra: «si este mes recorto en comer fuera,
 * ¿cuánto sube el suelo?». Para contestarla el ritmo tiene que salir de una
 * decisión, no de un promedio.
 *
 * Así que el histórico cambia de papel. Deja de mandar en la previsión y pasa a
 * ser la referencia contra la que se mide el plan: propone el reparto inicial y
 * avisa cuando lo que has decidido no se parece a lo que sueles hacer.
 *
 * El residuo no se calcula aparte: es `disponibleReal` sin el goteo. Tenía que
 * ser el mismo número que ya sale en portada o habría dos respuestas para
 * «cuánto me queda».
 *
 * Y una propiedad que ahorra un mecanismo entero: lo que ya te has gastado este
 * mes está dentro del saldo del banco. No hay que restarlo ni llevar cuenta
 * aparte, así que recortar el día 15 recalcula solo sobre los días que quedan.
 */

import { diasEntre, ultimoDiaDelMes } from '../dominio/tipos.js'
import { disponibleReal } from './mes.js'
import { repartirGasto } from './reparto.js'
import { CATEGORIAS } from '../entidades/semillas.js'

/**
 * @typedef {import('./bajamar.js').Evento} Evento
 * @typedef {import('../dominio/tipos.js').Movimiento} Movimiento
 */

/**
 * @typedef {object} Plan
 * @property {string} mes                        'yyyy-mm', el mes natural
 * @property {Record<string, number>} asignado   categoría → céntimos positivos
 * @property {number} residuo                    el que había cuando lo cuadraste
 * @property {string} sello                      cuándo lo cuadraste, ISO
 */

/**
 * @typedef {object} Cuadre
 * @property {number} residuo      lo que hay hoy para el día a día
 * @property {number} asignado     lo que has repartido
 * @property {number} sinRepartir  residuo − asignado; negativo = te has pasado
 * @property {number} desajuste    cuánto ha cambiado el residuo desde el sello
 * @property {boolean} pasado      true si has repartido más de lo que hay
 */

/**
 * Lo que queda para el día a día de aquí a fin de mes.
 *
 * Es `disponibleReal` con el goteo a cero: saldo de hoy, más lo que falta por
 * cobrar, menos lo que falta por pagar, menos el colchón que no quieres tocar.
 *
 * @param {object} entrada
 * @param {number} entrada.saldo          el del extracto
 * @param {Evento[]} entrada.eventos
 * @param {string} entrada.hoy
 * @param {string} [entrada.hasta]        por defecto, fin del mes natural de hoy
 * @param {number} [entrada.reserva]      colchón, en céntimos
 * @returns {number} céntimos; puede ser negativo
 */
export function residuoDelMes({ saldo, eventos, hoy, hasta, reserva = 0 }) {
  const fin = hasta ?? ultimoDiaDelMes(hoy)
  return disponibleReal({ saldo, eventos, ritmoPorDia: 0, hoy, hasta: fin, reserva }).total
}

/**
 * El reparto que propone la aplicación cuando todavía no has decidido nada.
 *
 * Propone lo que sueles gastar, no todo lo que tienes. Repartir el residuo
 * entero sería proponerte fundirte la cuenta: con 12.000 € ahorrados, la
 * propuesta diría 12.000 € en el día a día. Lo que sabemos de ti es tu
 * costumbre, así que eso es lo que se propone, y lo que sobra se queda sin
 * repartir a la vista.
 *
 * Sólo se topa cuando la costumbre no cabe: si sueles gastar 900 y este mes
 * quedan 600, la propuesta son 600 repartidos en tus mismas proporciones.
 *
 * No inventa proporciones: `repartirGasto` ya sabe trocear una cifra según lo
 * que pesó cada categoría en los meses cerrados, dejando fuera el mes en curso
 * por estar a medias, y cuadra los céntimos del redondeo.
 *
 * @param {Array<Movimiento & { categoria?: string }>} ordinarios
 * @param {object} entrada
 * @param {number} entrada.habitualPorMes  lo que sueles gastar al mes, con signo
 * @param {number} entrada.residuo         céntimos positivos
 * @returns {Record<string, number>} categoría → céntimos positivos
 */
export function proponerAsignado(ordinarios, { habitualPorMes, residuo }) {
  if (residuo <= 0) return {}
  const total = Math.min(Math.abs(habitualPorMes), residuo)
  if (total === 0) return {}

  /** @type {Record<string, number>} */
  const asignado = {}
  for (const trozo of repartirGasto(ordinarios, { porMes: -total })) {
    if (trozo.alMes === 0) continue
    asignado[trozo.categoria] = -trozo.alMes
  }
  return asignado
}

/**
 * Cómo va el plan contra la realidad de hoy.
 *
 * Deliberadamente no corrige nada. Si importas el extracto y aparece un cargo
 * que no esperabas, el residuo baja y tu reparto deja de cuadrar: la aplicación
 * te lo enseña y decides tú. Encoger las demás categorías en silencio sería la
 * aplicación gastando tu dinero por ti.
 *
 * @param {object} entrada
 * @param {Plan | null} entrada.plan
 * @param {number} entrada.residuo  el de hoy
 * @returns {Cuadre}
 */
export function cuadre({ plan, residuo }) {
  const asignado = plan ? sumar(plan.asignado) : 0
  return {
    residuo,
    asignado,
    sinRepartir: residuo - asignado,
    desajuste: plan ? residuo - plan.residuo : 0,
    pasado: asignado > residuo,
  }
}

/**
 * Reparte el desajuste entre las categorías, en proporción a lo que ya tenían.
 *
 * Es lo que hace el botón de recuadrar: el atajo para cuando el desajuste te da
 * igual y sólo quieres volver a cuadrar. Sigue siendo una decisión tuya, con un
 * clic en vez de con doce.
 *
 * @param {Plan} plan
 * @param {number} residuo
 * @returns {Record<string, number>}
 */
export function recuadrar(plan, residuo) {
  const total = sumar(plan.asignado)
  if (total <= 0 || residuo <= 0) return {}

  const claves = Object.keys(plan.asignado)
  /** @type {Record<string, number>} */
  const nuevo = {}
  for (const clave of claves) {
    nuevo[clave] = Math.round(residuo * (plan.asignado[clave] / total))
  }
  // Como en el reparto: los céntimos del redondeo van al trozo más gordo, o
  // habría dos cifras para lo mismo.
  const gordo = claves.reduce((a, b) => (nuevo[a] >= nuevo[b] ? a : b))
  nuevo[gordo] += residuo - sumar(nuevo)
  return nuevo
}

/**
 * El ritmo diario que sale del plan, para dárselo a `proyectar`.
 *
 * De cada categoría cuenta lo que le queda: lo asignado menos lo que ya llevas
 * gastado en ella este mes. Una categoría agotada aporta cero, no negativo —
 * pasarte en restaurantes no te devuelve dinero, sólo deja de haber más.
 *
 * Si el plan no cuadra con el residuo, este ritmo lo refleja y la bajamar baja.
 * Es la respuesta correcta: un plan que no cabe se tiene que ver.
 *
 * @param {object} entrada
 * @param {Plan | null} entrada.plan
 * @param {Record<string, number>} [entrada.gastado]  categoría → céntimos positivos
 * @param {string} entrada.hoy
 * @param {string} [entrada.hasta]
 * @returns {{ porDia: number, porMes: number, restante: number } | null} null si no hay plan
 */
export function ritmoDelPlan({ plan, gastado = {}, hoy, hasta }) {
  if (!plan) return null
  const fin = hasta ?? ultimoDiaDelMes(hoy)

  let restante = 0
  for (const [categoria, importe] of Object.entries(plan.asignado)) {
    restante += Math.max(importe - (gastado[categoria] ?? 0), 0)
  }

  // `proyectar` aplica el ritmo desde el día siguiente a `desde`, así que los
  // días que van a recibirlo son exactamente los que separan hoy del fin.
  const dias = Math.max(diasEntre(hoy, fin), 0)
  return {
    restante,
    porMes: -restante,
    porDia: dias === 0 ? 0 : -Math.round(restante / dias),
  }
}

/**
 * Un plan nuevo, cuadrado hoy con el residuo de hoy.
 *
 * @param {object} entrada
 * @param {string} entrada.mes
 * @param {Record<string, number>} entrada.asignado
 * @param {number} entrada.residuo
 * @param {string} entrada.hoy
 * @returns {Plan}
 */
export function sellar({ mes, asignado, residuo, hoy }) {
  return { mes, asignado, residuo, sello: hoy }
}

/** Nombre legible de una categoría, para la interfaz. */
export function nombreDe(categoria) {
  return CATEGORIAS[categoria] ?? categoria
}

/** @param {Record<string, number>} registro */
function sumar(registro) {
  return Object.values(registro).reduce((t, x) => t + x, 0)
}
