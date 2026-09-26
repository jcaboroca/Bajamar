// @ts-check
/**
 * La pregunta que ninguna cuenta puede contestar sola: ¿esto va a volver?
 *
 * Los extractos sólo saben del pasado. Que algo se haya repetido doce veces no
 * dice nada de la decimotercera: una cuenta se cierra, una compañía se cambia
 * y a un gimnasio se puede no ir. Como la respuesta vale para todo lo que
 * venga de ese comercio, se pregunta una vez y se recuerda.
 */

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
 * Deja una fila lista para que le pregunten.
 * @param {HTMLElement} fila
 * @param {string} entidadId
 */
export function marcarPreguntable(fila, entidadId) {
  fila.dataset.entidad = entidadId
  fila.tabIndex = 0
  fila.setAttribute('role', 'button')
}

/**
 * Escucha una lista entera en vez de cada fila: las filas se repintan en cada
 * cambio y sus escuchadores morirían con ellas.
 * @param {HTMLElement} caja
 * @param {() => { nombres: Map<string, string>, tratos: Record<string, Trato> } | null} mirarEstado
 * @param {(entidadId: string, trato: Trato) => unknown} alCambiar
 */
export function preguntarAlPulsar(caja, mirarEstado, alCambiar) {
  const abrir = async (/** @type {Element} */ objetivo) => {
    const fila = objetivo.closest('[data-entidad]')
    if (!(fila instanceof HTMLElement)) return
    const entidadId = fila.dataset.entidad
    const estado = mirarEstado()
    if (!entidadId || !estado) return
    const actual = estado.tratos[entidadId] ?? 'fijo'
    const elegido = await preguntarTrato({ nombre: estado.nombres.get(entidadId) ?? entidadId, actual })
    if (elegido === null || elegido === actual) return
    await alCambiar(entidadId, elegido)
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
