// @ts-check
/**
 * Los ladrillos con los que se construyen las vistas.
 *
 * Nada de plantillas de texto: todo se crea como nodos. Un `innerHTML` con
 * datos dentro es una inyección esperando a que alguien tenga un comercio
 * llamado `<script>`, y aquí los nombres vienen de un fichero que la
 * aplicación no ha escrito.
 */

/**
 * @param {string} etiqueta
 * @param {string} [clase]
 * @param {string} [contenido]
 */
export function nodo(etiqueta, clase = '', contenido = '') {
  const n = document.createElement(etiqueta)
  if (clase) n.className = clase
  if (contenido) n.textContent = contenido
  return n
}

/**
 * @param {string} id
 * @returns {HTMLElement}
 */
export function requerir(id) {
  const n = document.getElementById(id)
  if (!n) throw new Error(`falta el elemento #${id}`)
  return n
}

/**
 * A tamaño de titular, el espacio de una monoespaciada abre un hueco de medio
 * dedo antes del símbolo. Se compone aparte para poder volarlo.
 * @param {string} texto
 */
export function titular(texto) {
  const corte = texto.lastIndexOf(' ')
  if (corte < 0) return [document.createTextNode(texto)]
  const moneda = nodo('span', 'moneda', texto.slice(corte + 1))
  return [document.createTextNode(texto.slice(0, corte)), moneda]
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** @param {string} iso */
export function diaYMes(iso) {
  return `${Number(iso.slice(8, 10))} ${MESES_CORTOS[Number(iso.slice(5, 7)) - 1]}`
}

/** Día, mes y año escritos como los escribiría una persona. @param {string} iso */
export function fechaLarga(iso) {
  return `${Number(iso.slice(8, 10))} de ${MESES_LARGOS[Number(iso.slice(5, 7)) - 1]} de ${iso.slice(0, 4)}`
}

/** @param {string} mes "2026-10" */
export function nombreDeMes(mes) {
  const nombre = MESES_LARGOS[Number(mes.slice(5, 7)) - 1]
  return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)}`
}

/**
 * Una línea de lista con fecha, nombre, detalle e importe.
 * @param {object} e
 * @param {string} [e.marca]
 * @param {string} e.nombre
 * @param {string} [e.detalle]
 * @param {string} e.importe
 * @param {string} [e.clase]
 */
export function linea({ marca, nombre, detalle, importe, clase = '' }) {
  const li = nodo('li', clase)
  if (marca !== undefined) li.append(nodo('span', 'evento-fecha cifras', marca))
  const medio = nodo('div', 'evento-nombre')
  medio.append(nodo('span', '', nombre))
  if (detalle) medio.append(nodo('span', 'evento-detalle', detalle))
  li.append(medio, nodo('span', 'evento-importe', importe))
  return li
}

/**
 * Barra de progreso. Por encima del 100% se colorea distinto en vez de
 * desbordarse: el exceso se lee en la cifra, no en un rectángulo roto.
 * @param {number} porcentaje
 */
export function barra(porcentaje) {
  const caja = nodo('div', 'barra')
  const relleno = nodo('i')
  relleno.style.width = `${Math.min(Math.max(porcentaje, 0), 100)}%`
  if (porcentaje > 100) caja.classList.add('pasada')
  caja.append(relleno)
  return caja
}

/**
 * Dos columnas: concepto a la izquierda, cifra a la derecha.
 * @param {Array<[string, string, string?]>} pares  [concepto, cifra, clase]
 */
export function cuentas(pares) {
  const dl = nodo('dl', 'datos')
  for (const [concepto, cifra, clase] of pares) {
    dl.append(nodo('dt', '', concepto), nodo('dd', `cifras ${clase ?? ''}`.trim(), cifra))
  }
  return dl
}

/**
 * Bloque vacío con explicación. Un cero sin contexto no informa de nada:
 * hace creer que la aplicación está rota.
 * @param {string} texto
 */
export function vacio(texto) {
  return nodo('p', 'aclaracion vacio', texto)
}
