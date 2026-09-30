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
import { CATEGORIAS } from '../entidades/semillas.js'
import { pedirDatos } from './hoja.js'

/** @typedef {'fijo' | 'suelto' | 'baja'} Trato */

const OPCIONES = /** @type {Array<[string, string]>} */ ([
  ['fijo', 'Sí, siempre'],
  ['suelto', 'Sí, pero me lo puedo saltar'],
  ['baja', 'Ya no lo pago'],
])

const RITMOS = /** @type {Array<[string, string]>} */ ([
  ['', 'Como lo vea por las fechas'],
  ['mensual', 'Cada mes'],
  ['bimestral', 'Cada dos meses'],
  ['trimestral', 'Cada tres meses'],
  ['semestral', 'Cada seis meses'],
  ['anual', 'Una vez al año'],
])

/**
 * @param {object} p
 * @param {string} p.nombre
 * @param {Trato} [p.actual]
 * @param {string} [p.apodo]
 * @param {string} [p.categoria]
 * @param {string} [p.ritmo]
 * @param {string} [p.devuelto]
 * @returns {Promise<{ trato: Trato, apodo: string, categoria: string, ritmo: string, devuelto: string } | null>}  null si se arrepiente
 */
async function preguntarTrato({ nombre, actual = 'fijo', apodo = '', categoria = 'otros', ritmo = '', devuelto = '' }) {
  const respuesta = await pedirDatos({
    titulo: nombre,
    aceptar: 'Guardar',
    campos: [{
      nombre: 'apodo',
      etiqueta: '¿Qué es?',
      tipo: 'texto',
      valor: apodo,
      pista: 'Déjalo en blanco para el nombre del banco',
    }, {
      nombre: 'categoria',
      etiqueta: '¿De qué tipo?',
      tipo: 'lista',
      valor: categoria,
      opciones: Object.entries(CATEGORIAS),
      // Va por recibo: del mismo PayPal salen dos suscripciones y una compra
      // suelta, y no son lo mismo.
      pista: 'Sólo para este recibo, no para todo lo que cobre el mismo sitio.',
    }, {
      nombre: 'ritmo',
      etiqueta: '¿Cada cuánto llega?',
      tipo: 'lista',
      valor: ritmo,
      opciones: RITMOS,
      pista: 'Normalmente lo deduzco de las fechas, pero a veces me equivoco: entre muchas compras del mismo sitio, la cuota se camufla.',
    }, {
      nombre: 'trato',
      etiqueta: '¿Lo vas a seguir pagando?',
      tipo: 'lista',
      valor: actual,
      opciones: OPCIONES,
      pista: 'Si ya no lo pagas, desaparece de la previsión. Lo que ya pagaste no se toca. Si te lo puedes saltar, lo sigo previendo —porque casi todos los meses sale— pero te digo cuánto margen te daría saltártelo en un mes apurado.',
    }, {
      nombre: 'devuelto',
      etiqueta: '¿Te lo devuelve alguien?',
      tipo: 'texto',
      valor: devuelto,
      pista: 'Escribe quién. Sigue saliendo de tu cuenta el día que toca —ahí no te engaño—, pero deja de contar como gasto tuyo del mes.',
    }],
  })
  if (respuesta === null || respuesta === 'borrar') return null
  const elegido = respuesta.trato
  return {
    trato: elegido === 'suelto' || elegido === 'baja' ? elegido : 'fijo',
    apodo: String(respuesta.apodo ?? ''),
    categoria: String(respuesta.categoria ?? categoria),
    ritmo: String(respuesta.ritmo ?? ''),
    devuelto: String(respuesta.devuelto ?? ''),
  }
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
 * @param {string} [categoria]
 */
export function marcarPreguntable(fila, reciboId, rotulo, categoria) {
  fila.dataset.recibo = reciboId
  if (rotulo) fila.dataset.rotulo = rotulo
  if (categoria) fila.dataset.categoria = categoria
  fila.tabIndex = 0
  fila.setAttribute('role', 'button')
}

/**
 * Escucha una lista entera en vez de cada fila: las filas se repintan en cada
 * cambio y sus escuchadores morirían con ellas.
 * @param {HTMLElement} caja
 * @param {() => { nombres: Map<string, string>, tratos: Record<string, Trato>, apodos: Record<string, string>, ritmos?: Record<string, string>, devueltos?: Record<string, string> } | null} mirarEstado
 * @param {(cambio: { reciboId: string, trato: Trato, apodo: string, categoria: string, ritmo: string, devuelto: string, cambiaTrato: boolean }) => unknown} alCambiar
 */
export function preguntarAlPulsar(caja, mirarEstado, alCambiar) {
  const abrir = async (/** @type {Element} */ objetivo) => {
    // Los botones de acción de una fila hacen lo suyo y no abren el diálogo.
    // Antes lo evitaban cortando la propagación, pero eso mataba también al
    // manejador que escucha en esta misma caja: el botón de «este mes no»
    // pintaba, guardaba sus datos y al pulsarlo no ocurría absolutamente nada.
    if (objetivo.closest('[data-saltar], [data-apagar], [data-inversion], input, label')) return
    const fila = objetivo.closest('[data-recibo]')
    if (!(fila instanceof HTMLElement)) return
    const reciboId = fila.dataset.recibo
    const estado = mirarEstado()
    if (!reciboId || !estado) return
    const actual = estado.tratos[reciboId] ?? 'fijo'
    const apodo = estado.apodos[reciboId] ?? ''
    const categoria = fila.dataset.categoria ?? 'otros'
    const ritmo = estado.ritmos?.[reciboId] ?? ''
    const devuelto = estado.devueltos?.[reciboId] ?? ''
    const nombre = fila.dataset.rotulo ?? estado.nombres.get(reciboId.split('#')[0]) ?? reciboId
    const elegido = await preguntarTrato({ nombre, actual, apodo, categoria, ritmo, devuelto })
    if (elegido === null) return
    if (elegido.trato === actual && elegido.apodo === apodo && elegido.categoria === categoria && elegido.ritmo === ritmo && elegido.devuelto === devuelto) return
    await alCambiar({ reciboId, ...elegido, cambiaTrato: elegido.trato !== actual })
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
