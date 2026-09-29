// @ts-check
/**
 * Categorías: todo lo que se repite.
 *
 * Qué se repite, cada cuánto vuelve y cuánto vale. Son cuatro estados de la
 * misma cosa —un recibo reconocido, una suscripción, uno que no sé si volverá y
 * uno que ya no pagas— y por eso viven juntos.
 *
 * Estaban en Previsión, que así contestaba dos preguntas a la vez: «¿cómo va
 * este mes?» y «¿qué tengo contratado?». La primera se decide cada semana y la
 * segunda se toca dos veces al año.
 */

import { formatEuros, formatEurosRedondo } from '../../dominio/dinero.js'
import { diaYMes, linea, nodo, nombreDeMes, requerir, vacio } from '../piezas.js'
import { marcarPreguntable, preguntarAlPulsar, rotuloDe } from '../trato.js'

/**
 * @typedef {ReturnType<typeof import('../../estado.js').construirEstado>} Estado
 */

/** @type {Estado | null} */
let ultimo = null

/**
 * Qué grupos has plegado. Cualquier decisión repinta la pestaña entera, así que
 * si no se recuerda aquí se te vuelven a abrir todos en cuanto tocas algo.
 * @type {Set<string>}
 */
const cerrados = new Set()

/** Cada cuánto llega, dicho como se dice. */
const CADA_CUANTO = {
  mensual: 'al mes',
  bimestral: 'cada dos meses',
  trimestral: 'cada tres meses',
  semestral: 'cada seis meses',
  anual: 'una vez al año',
}

export function montarCategorias({ alCambiarTrato, alMarcarAnual }) {
  for (const caja of ['fijos', 'apartados']) {
    preguntarAlPulsar(requerir(caja), () => ultimo, alCambiarTrato)
  }
  requerir('preguntas').addEventListener('change', (e) => {
    const casilla = e.target
    if (!(casilla instanceof HTMLInputElement) || !casilla.dataset.anual) return
    alMarcarAnual(casilla.dataset.anual, casilla.checked)
  })
}

/** @param {Estado} estado */
export function pintarCategorias(estado) {
  ultimo = estado
  pintarFijos(estado)
  pintarPreguntas(estado)
  pintarApartados(estado)
}

/** @param {Estado} estado */
function pintarFijos(estado) {
  const c = estado.costes
  const caja = requerir('fijos')

  /**
   * @param {string} titulo
   * @param {string} explicacion
   * @param {import('../../analisis/fijos.js').Fijo[]} lista
   */
  const grupo = (titulo, explicacion, lista) => {
    if (lista.length === 0) return null
    const div = nodo('details', 'grupo')
    // Se abren todos la primera vez: plegar es para quitar de en medio lo que
    // no interesa, no para esconder de entrada lo que antes se veía.
    div.open = !cerrados.has(titulo)
    div.addEventListener('toggle', () => {
      if (div.open) cerrados.delete(titulo)
      else cerrados.add(titulo)
    })
    const suma = lista.reduce((t, f) => t + f.mensualEquivalente, 0)
    const cabeza = nodo('summary', 'grupo-cabecera')
    cabeza.append(
      nodo('span', 'rotulo rotulo-menor', titulo),
      nodo('span', 'cifras grupo-suma', `${formatEuros(suma)} al mes`),
    )
    div.append(cabeza, nodo('p', 'aclaracion', explicacion))
    const ol = nodo('ol', 'eventos pulsables')
    for (const f of lista) {
      const cada = f.periodicidad === 'mensual' ? 'al mes' : CADA_CUANTO[f.periodicidad]
      const equivalente = f.periodicidad === 'mensual' ? '' : ` · ${formatEuros(f.mensualEquivalente)} al mes equivalente`
      const fila = linea({
        marca: diaYMes(f.proximaPrevista),
        nombre: f.nombre,
        detalle: `${cada}${equivalente}${f.aplazable ? ' · te lo puedes saltar' : ''}`,
        importe: formatEuros(f.importeEsperado),
        clase: f.estado === 'retrasado' ? 'apagado' : '',
      })
      marcarPreguntable(fila, f.reciboId, rotuloDe(f.reciboId, f.nombre, f.importeEsperado), f.categoria)
      ol.append(fila)
    }
    div.append(ol)
    return div
  }

  // Se agrupa por qué clase de gasto es, no por cada cuánto se paga: un seguro
  // sigue siendo un seguro lo cobren al mes o al año.
  const todos = [...c.mensuales, ...c.variables, ...c.periodicos, ...c.anuales]
  const de = (categoria) => todos.filter((f) => f.categoria === categoria)
  const clasificados = new Set(['suscripciones', 'impuestos', 'seguros'])
  const resto = todos.filter((f) => !clasificados.has(f.categoria))

  const grupos = [
    grupo(
      'Gastos fijos al mes',
      'Lo que se va todos los meses pase lo que pase.',
      resto.filter((f) => f.periodicidad === 'mensual'),
    ),
    grupo(
      'Suscripciones',
      `Entre todas, ${formatEuros(c.suscripcionesMes)} al mes. Al año son ${formatEurosRedondo(c.suscripcionesAnio)}.`,
      de('suscripciones'),
    ),
    grupo('Impuestos', 'Lo que hay que ver venir con meses de antelación.', de('impuestos')),
    grupo('Seguros', 'Pólizas, se paguen al mes o de una vez al año.', de('seguros')),
    grupo(
      'Cada pocos meses',
      'Ni mensual ni de las de arriba: llega de tanto en tanto.',
      resto.filter((f) => f.periodicidad !== 'mensual'),
    ),
  ].filter((g) => g !== null)

  if (grupos.length === 0) {
    caja.replaceChildren(vacio(
      'Todavía no he reconocido ningún recibo periódico. Hacen falta tres o cuatro '
      + 'apariciones del mismo cobrador para no confundir una costumbre con un compromiso.',
    ))
    return
  }

  caja.replaceChildren(...grupos)
}

/** @param {Estado} estado */
function pintarPreguntas(estado) {
  const bloque = requerir('bloque-preguntas')
  bloque.hidden = estado.dudosos.length === 0
  if (estado.dudosos.length === 0) return
  requerir('preguntas').replaceChildren(...estado.dudosos.map((d) => {
    const fila = linea({
      marca: diaYMes(d.fecha),
      nombre: d.nombre,
      detalle: `la última vez hace ${d.meses} meses · ¿vuelve?`,
      importe: formatEuros(d.importe, { signo: true }),
      clase: 'previsto',
    })
    fila.append(casillaAnual(d.entidadId, d.nombre, estado.anuales[d.entidadId] === true))
    return fila
  }))
}

/**
 * La app no puede distinguir un seguro anual visto una vez de un pago único, y
 * ese es justo el dato que el usuario tiene y ella no.
 * @param {string} entidadId
 * @param {string} nombre
 * @param {boolean} marcado
 */
function casillaAnual(entidadId, nombre, marcado) {
  const etiqueta = nodo('label', 'clasificar-unico pregunta-anual')
  const casilla = document.createElement('input')
  casilla.type = 'checkbox'
  casilla.dataset.anual = entidadId
  casilla.checked = marcado
  casilla.setAttribute('aria-label', `${nombre} vuelve cada año`)
  etiqueta.append(casilla, nodo('span', '', 'Sí, vuelve cada año'))
  return etiqueta
}

/**
 * Lo que el usuario ha sacado de la previsión. Sin esta lista, decir «ya no lo
 * pago» sería una puerta de una sola dirección: lo apartado desaparece de
 * todas partes y no habría dónde volver a encontrarlo.
 * @param {Estado} estado
 */
function pintarApartados(estado) {
  requerir('bloque-apartados').hidden = estado.apartados.length === 0
  requerir('apartados').replaceChildren(...estado.apartados.map((a) => {
    const detalle = a.motivo === 'extinto'
      ? `dejó de pasar en ${nombreDeMes(a.ultima).toLowerCase()}`
      : 'ya no lo pagas'
    const fila = linea({ nombre: a.nombre, detalle, importe: '', clase: 'apagado' })
    marcarPreguntable(fila, a.reciboId, rotuloDe(a.reciboId, a.nombre, a.importe))
    return fila
  }))
}
