// @ts-check
/**
 * La lámina de agua.
 *
 * No es un gráfico: no tiene ejes, ni rejilla, ni leyenda, ni más etiquetas
 * que las dos que hacen falta. Es la silueta del saldo a lo largo del mes, y
 * lo único que se pide de ella es que se vea de un vistazo dónde baja.
 *
 * La escala vertical siempre incluye el cero. Sin eso, un saldo que cae de
 * 3.900 a 3.400 dibujaría un acantilado y uno que cae de 3.900 a 0 dibujaría
 * lo mismo: el gráfico mentiría por encuadre.
 */

import { formatEurosRedondo } from '../dominio/dinero.js'
import { fechaLarga } from '../dominio/tipos.js'

const ANCHO = 700
const ALTO = 200
const MARGEN_SUPERIOR = 28
const MARGEN_INFERIOR = 24

/**
 * @param {import('../analisis/bajamar.js').Proyeccion} proyeccion
 * @param {{ marca?: string }} [opciones] distingue el degradado cuando hay dos láminas a la vez
 * @returns {SVGSVGElement}
 */
export function dibujarLamina(proyeccion, opciones = {}) {
  const marca = opciones.marca ?? 'agua'
  const puntos = proyeccion.curva
  /*
   * Puede haber dos lecturas del mismo mes: lo que dice el banco y lo que es
   * dinero de este mes. Se separan el día que entra una nómina que paga el
   * siguiente, y esa separación explica sola por qué el punto más bajo está
   * donde está. La escala tiene que abarcar las dos o una se saldría.
   */
  const hayPropia = puntos.some((p) => typeof p.propio === 'number' && p.propio !== p.saldo)
  const valores = hayPropia
    ? puntos.flatMap((p) => [p.saldo, p.propio])
    : puntos.map((p) => p.saldo)
  const techo = Math.max(...valores, 0)
  const sueloEscala = Math.min(...valores, 0)
  const rango = Math.max(techo - sueloEscala, 1)

  const x = (i) => (i / Math.max(puntos.length - 1, 1)) * ANCHO
  const y = (v) => MARGEN_SUPERIOR + (1 - (v - sueloEscala) / rango) * (ALTO - MARGEN_SUPERIOR - MARGEN_INFERIOR)

  const linea = puntos.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.saldo).toFixed(1)}`).join('')
  const lineaPropia = hayPropia
    ? puntos.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.propio).toFixed(1)}`).join('')
    : null
  const base = y(Math.max(sueloEscala, 0)).toFixed(1)
  const area = `${linea}L${ANCHO},${base}L0,${base}Z`

  const iSuelo = puntos.findIndex((p) => p.fecha === proyeccion.suelo.fecha)
  const xSuelo = x(Math.max(iSuelo, 0))
  const ySuelo = y(proyeccion.suelo.saldo)

  const svg = crear('svg', {
    viewBox: `0 0 ${ANCHO} ${ALTO}`,
    role: 'img',
    'aria-label':
      `Saldo previsto desde el ${fechaLarga(proyeccion.desde)} hasta el ${fechaLarga(proyeccion.hasta)}. ` +
      `El mínimo es ${formatEurosRedondo(proyeccion.suelo.saldo)} el ${fechaLarga(proyeccion.suelo.fecha)}.`,
  })

  svg.append(
    degradado(marca),
    crear('path', { class: 'relleno-agua', d: area, fill: `url(#degradado-${marca})` }),
  )

  // El cero sólo se dibuja si la proyección lo cruza: si no, es una línea que
  // no cuenta nada y sólo añade ruido.
  if (sueloEscala < 0) {
    svg.append(crear('line', {
      x1: 0, x2: ANCHO, y1: y(0), y2: y(0),
      stroke: 'var(--linea)', 'stroke-width': 1,
    }))
  }

  svg.append(
    crear('path', { class: 'trazo-agua', d: linea }),
    ...(lineaPropia ? [crear('path', { class: 'trazo-propio', d: lineaPropia })] : []),
    crear('line', { class: 'marca-suelo', x1: xSuelo, x2: xSuelo, y1: ySuelo, y2: ALTO - MARGEN_INFERIOR + 6 }),
    crear('circle', { class: 'punto-suelo', cx: xSuelo, cy: ySuelo, r: 3.5 }),
    // El rótulo del arranque no siempre es «hoy»: mirando un mes que aún no ha
    // empezado, lo que hay a la izquierda es con cuánto entras en él.
    texto(4, ALTO - 4, `${opciones.rotuloInicio ?? 'hoy'} · ${formatEurosRedondo(proyeccion.saldoInicial)}`),
    texto(
      Math.min(Math.max(xSuelo, 60), ANCHO - 60),
      ALTO - 4,
      fechaLarga(proyeccion.suelo.fecha),
      'destacada',
      'middle',
    ),
  )

  // La animación necesita saber cuánto mide el trazo para poder recorrerlo.
  const trazo = svg.querySelector('.trazo-agua')
  if (trazo instanceof SVGPathElement) {
    svg.style.setProperty('--largo', String(Math.ceil(trazo.getTotalLength?.() ?? ANCHO)))
  }

  return svg
}

/** @param {string} marca */
function degradado(marca) {
  const defs = crear('defs')
  const grad = crear('linearGradient', { id: `degradado-${marca}`, x1: 0, y1: 0, x2: 0, y2: 1 })
  grad.append(
    crear('stop', { offset: '0%', 'stop-color': 'var(--agua)', 'stop-opacity': 0.28 }),
    crear('stop', { offset: '100%', 'stop-color': 'var(--agua)', 'stop-opacity': 0 }),
  )
  defs.append(grad)
  return defs
}

/**
 * @param {number} x
 * @param {number} y
 * @param {string} contenido
 * @param {string} [extra]
 * @param {string} [anclaje]
 */
function texto(x, y, contenido, extra = '', anclaje = 'start') {
  const t = crear('text', { class: `etiqueta-lamina ${extra}`.trim(), x, y, 'text-anchor': anclaje })
  t.textContent = contenido
  return t
}

/**
 * @param {string} etiqueta
 * @param {Record<string, string | number>} [atributos]
 */
function crear(etiqueta, atributos = {}) {
  const nodo = document.createElementNS('http://www.w3.org/2000/svg', etiqueta)
  for (const [clave, valor] of Object.entries(atributos)) nodo.setAttribute(clave, String(valor))
  return nodo
}
