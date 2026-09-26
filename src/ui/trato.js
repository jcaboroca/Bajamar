// @ts-check
/**
 * La pregunta que ninguna cuenta puede contestar sola: ¿esto va a volver?
 *
 * Los extractos sólo saben del pasado. Que algo se haya repetido doce veces no
 * dice nada de la decimotercera: una cuenta se cierra, una compañía se cambia
 * y a un gimnasio se puede no ir. La respuesta se guarda por recibo, no por
 * comercio: del mismo banco puede salir una inversión que uno se salta y la
 * letra de una furgoneta que no.
 */

import { formatEuros } from '../dominio/dinero.js'
import { pedirDatos } from './hoja.js'

/** @typedef {'fijo' | 'suelto' | 'baja'} Trato */

const OPCIONES = /** @type {Array<[string, string]>} */ ([
  ['fijo', 'Sí, siempre'],
  ['suelto', 'Sí, pero me lo puedo saltar'],
  ['baja', 'Ya no lo pago'],
])

/**
 * @param {object} p
 * @param {string} p.nombre
 * @param {Trato} [p.actual]
 * @returns {Promise<Trato | null>}  null si se arrepiente
 */
export async function preguntarTrato({ nombre, actual = 'fijo' }) {
  const respuesta = await pedirDatos({
    titulo: nombre,
    aceptar: 'Guardar',
    campos: [{
      nombre: 'trato',
      etiqueta: '¿Lo vas a seguir pagando?',
      tipo: 'lista',
      valor: actual,
      opciones: OPCIONES,
      pista: 'Si ya no lo pagas, desaparece de la previsión. Lo que ya pagaste no se toca. Si te lo puedes saltar, lo sigo previendo —porque casi todos los meses sale— pero te digo cuánto margen te daría saltarlo en un mes apurado.',
    }],
  })
  if (respuesta === null || respuesta === 'borrar') return null
  const elegido = respuesta.trato
  return elegido === 'suelto' || elegido === 'baja' ? elegido : 'fijo'
}

/**
 * Cómo llamar a un recibo al preguntar por él. Cuando el cobrador tiene varios,
 * el nombre a secas no basta: «MyInvestor» son dos cosas distintas y una de
 * ellas es la letra de la furgoneta.
 * @param {string} reciboId
 * @param {string} nombre
 * @param {number} importe céntimos
 */
export function rotuloDe(reciboId, nombre, importe) {
  return reciboId.includes('#') ? `${nombre} de ${formatEuros(Math.abs(importe))}` : nombre
}

/**
 * Deja una fila lista para que le pregunten. El rótulo viaja con ella porque
 * dos recibos del mismo cobrador comparten nombre y el diálogo tiene que
 * decir por cuál de los dos está preguntando.
 * @param {HTMLElement} fila
 * @param {string} reciboId
 * @param {string} [rotulo]
 */
export function marcarPreguntable(fila, reciboId, rotulo) {
  fila.dataset.recibo = reciboId
  if (rotulo) fila.dataset.rotulo = rotulo
  fila.tabIndex = 0
  fila.setAttribute('role', 'button')
}

/**
 * Escucha una lista entera en vez de cada fila: las filas se repintan en cada
 * cambio y sus escuchadores morirían con ellas.
 * @param {HTMLElement} caja
 * @param {() => { nombres: Map<string, string>, tratos: Record<string, Trato> } | null} mirarEstado
 * @param {(reciboId: string, trato: Trato) => unknown} alCambiar
 */
export function preguntarAlPulsar(caja, mirarEstado, alCambiar) {
  const abrir = async (/** @type {Element} */ objetivo) => {
    const fila = objetivo.closest('[data-recibo]')
    if (!(fila instanceof HTMLElement)) return
    const reciboId = fila.dataset.recibo
    const estado = mirarEstado()
    if (!reciboId || !estado) return
    const actual = estado.tratos[reciboId] ?? 'fijo'
    const nombre = fila.dataset.rotulo ?? estado.nombres.get(reciboId.split('#')[0]) ?? reciboId
    const elegido = await preguntarTrato({ nombre, actual })
    if (elegido === null || elegido === actual) return
    await alCambiar(reciboId, elegido)
  }

  caja.addEventListener('click', (e) => {
    if (e.target instanceof Element) abrir(e.target)
  })
  caja.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    if (!(e.target instanceof Element) || !e.target.matches('[data-entidad]')) return
    e.preventDefault()
    abrir(e.target)
  })
}
