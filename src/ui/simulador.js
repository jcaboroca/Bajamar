// @ts-check
/**
 * Qué pasaría si gastaras menos.
 *
 * Lo fijo y lo variable no se tocan igual y por eso no se enseñan igual: los
 * recibos no tienen barra, porque para dejar de pagar Netflix no se mueve un
 * deslizador, se da de baja. Lo que sí se puede decidir mañana por la mañana
 * —la compra, los bares, la gasolina— lleva barra.
 *
 * Y mueve dos cifras a la vez a propósito. El ahorro al mes es lo que todo el
 * mundo enseña y es la mitad de la respuesta: lo que de verdad cambia tu vida
 * es que el punto más bajo del mes deje de dar miedo.
 */

import { formatEuros, formatEurosRedondo } from '../dominio/dinero.js'
import { proyectar } from '../analisis/bajamar.js'
import { CATEGORIAS } from '../entidades/semillas.js'
import { nodo, requerir } from './piezas.js'

/**
 * @typedef {ReturnType<typeof import('../estado.js').construirEstado>} Estado
 */

/** Por debajo de esto una barra no decide nada y sólo alarga la lista. */
const MINIMO_AL_MES = 500

/**
 * Gasto real que no se recorta decidiéndolo. La liquidación de la tarjeta es la
 * factura de lo que ya compraste, y lo que compraste ya está repartido en sus
 * categorías: ponerle barra sería ofrecer recortar dos veces el mismo dinero.
 */
const SIN_BARRA = new Set(['tarjeta'])

/** categoría → qué parte se recorta, de 0 a 1 */
const recortes = new Map()

/** @type {Estado | null} */
let ultimo = null

export function montarSimulador({ alApagarCategoria }) {
  requerir('simulador').addEventListener('input', (e) => {
    const barra = e.target
    if (!(barra instanceof HTMLInputElement) || !barra.dataset.categoria) return
    recortes.set(barra.dataset.categoria, 1 - Number(barra.value) / 100)
    ofrecerApagar(barra)
    if (ultimo) refrescarCifras(ultimo)
  })

  requerir('simulador').addEventListener('change', (e) => {
    const casilla = e.target
    if (!(casilla instanceof HTMLInputElement) || !casilla.dataset.apagar) return
    // El recorte simulado deja de tener sentido: la categoría entera sale del
    // goteo, no es que se gaste menos en ella.
    recortes.delete(casilla.dataset.apagar)
    alApagarCategoria(casilla.dataset.apagar, casilla.checked)
  })

  requerir('simulador-reset').addEventListener('click', () => {
    recortes.clear()
    if (ultimo) pintarSimulador(ultimo)
  })
}

/** @param {Estado} estado */
export function pintarSimulador(estado) {
  ultimo = estado
  const palancas = estado.reparto.filter(
    (t) => Math.abs(t.alMes) >= MINIMO_AL_MES && !SIN_BARRA.has(t.categoria),
  )
  const lista = requerir('simulador')
  const apagadas = estado.apagadas.map((c) => apagada(c))

  if (palancas.length === 0) {
    lista.replaceChildren(...apagadas)
    requerir('simulador-pie').textContent = 'Aún no hay meses cerrados suficientes para saber en qué se te va.'
    return
  }

  lista.replaceChildren(fijos(estado), ...palancas.map((t) => palanca(t)), ...apagadas)

  const sueltos = estado.reparto.filter(
    (t) => Math.abs(t.alMes) < MINIMO_AL_MES && !SIN_BARRA.has(t.categoria),
  ).length
  const base = 'Las barras reparten tu gasto del día a día, no los recibos'
  const fuera = sueltos === 0
    ? `${base}: suman exactamente lo que gastas.`
    : `${base}. Quedan fuera ${sueltos} categorías que no llegan a 5 € al mes.`
  requerir('simulador-pie').textContent = `${fuera} Si algo no toca esta temporada, `
    + 'baja su barra del todo y podrás sacarlo de la previsión.'

  refrescarCifras(estado)
}

/**
 * Apagada sigue en la lista, al final, o no habría forma de volver a encenderla.
 * @param {string} categoria
 */
function apagada(categoria) {
  const li = nodo('li', 'palanca palanca-apagada')
  const cabecera = nodo('div', 'mes-cabecera')
  cabecera.append(nodo('span', 'mes-nombre', CATEGORIAS[categoria] ?? categoria))
  li.append(cabecera, interruptor(categoria, CATEGORIAS[categoria] ?? categoria, true))
  return li
}

/**
 * El interruptor no está siempre: diecinueve casillas repetidas taparan la lista
 * y nadie apaga una categoría sin haber mirado antes qué pasa si la recorta.
 * Aparece cuando la barra llega a cero, que es justo cuando el usuario acaba de
 * decir «en esto no voy a gastar».
 * @param {HTMLInputElement} barra
 */
function ofrecerApagar(barra) {
  const fila = barra.closest('li')
  if (!fila) return
  const puesto = fila.querySelector('.palanca-apagar')
  if (Number(barra.value) > 0) {
    puesto?.remove()
    return
  }
  if (puesto) return
  const nombre = fila.querySelector('.mes-nombre')?.textContent ?? ''
  fila.append(interruptor(String(barra.dataset.categoria), nombre, false))
}

/**
 * @param {string} categoria
 * @param {string} nombre
 * @param {boolean} marcado
 */
function interruptor(categoria, nombre, marcado) {
  const etiqueta = nodo('label', 'palanca-apagar')
  const casilla = document.createElement('input')
  casilla.type = 'checkbox'
  casilla.dataset.apagar = categoria
  casilla.checked = marcado
  casilla.setAttribute('aria-label', `No tengo previsto gastar en ${nombre}`)
  etiqueta.append(casilla, nodo('span', '', marcado
    ? 'No toca esta temporada'
    : 'Quitarlo de la previsión: no toca esta temporada'))
  return etiqueta
}

/**
 * Los recibos abren la lista aunque no se puedan arrastrar: sin ellos delante,
 * parecería que el mes se decide a base de cañas.
 * @param {Estado} estado
 */
function fijos(estado) {
  const li = nodo('li', 'palanca palanca-fija')
  const cabecera = nodo('div', 'mes-cabecera')
  cabecera.append(nodo('span', 'mes-nombre', 'Recibos fijos'))
  cabecera.append(nodo('span', 'cifras', formatEuros(-Math.abs(estado.costes.costeMensual))))
  li.append(cabecera)
  li.append(nodo('p', 'mes-aviso', estado.aplazableAlMes === 0
    ? 'No se arrastran: un recibo se quita dándolo de baja, en la lista de abajo.'
    : `No se arrastran: se quitan dándolos de baja, abajo. ${formatEuros(Math.abs(estado.aplazableAlMes))} son saltables.`))
  return li
}

/** @param {import('../analisis/reparto.js').Trozo} trozo */
function palanca(trozo) {
  const li = nodo('li', 'palanca')

  const cabecera = nodo('div', 'mes-cabecera')
  cabecera.append(nodo('span', 'mes-nombre', trozo.nombre))
  const cifra = nodo('span', 'cifras')
  cifra.dataset.cifra = trozo.categoria
  cabecera.append(cifra)
  li.append(cabecera)

  const barra = document.createElement('input')
  barra.type = 'range'
  barra.min = '0'
  barra.max = '100'
  barra.step = '5'
  barra.value = String(Math.round((1 - (recortes.get(trozo.categoria) ?? 0)) * 100))
  barra.dataset.categoria = trozo.categoria
  barra.setAttribute('aria-label', `Cuánto gastarías en ${trozo.nombre}`)
  li.append(barra)
  if (barra.value === '0') li.append(interruptor(trozo.categoria, trozo.nombre, false))
  return li
}

/**
 * La única cuenta del módulo: el goteo baja, y con él baja el suelo.
 * @param {Estado} estado
 */
function refrescarCifras(estado) {
  let alMes = 0
  for (const t of estado.reparto) {
    const queda = 1 - (recortes.get(t.categoria) ?? 0)
    alMes += t.alMes * queda
    const cifra = requerir('simulador').querySelector(`[data-cifra="${t.categoria}"]`)
    if (cifra) cifra.textContent = formatEuros(Math.round(t.alMes * queda) || 0)
  }
  alMes = Math.round(alMes)

  const nueva = proyectar({
    saldoInicial: estado.saldoInicial,
    desde: estado.hoy,
    hasta: estado.proyeccion.hasta,
    eventos: estado.proyeccion.eventos,
    ritmoPorDia: Math.round(alMes / 30.4),
  })

  const ahorro = alMes - estado.ritmo.porMes
  requerir('simulador-suelo').textContent = formatEurosRedondo(nueva.suelo.saldo)
  requerir('simulador-reset').hidden = ahorro < 100

  requerir('simulador-efecto').textContent = ahorro < 100
    ? 'Arrastra una barra y verás moverse dos cosas: tu punto más bajo y lo que te llevas al año.'
    : `Tu punto más bajo pasa de ${formatEurosRedondo(estado.proyeccion.suelo.saldo)} `
      + `a ${formatEurosRedondo(nueva.suelo.saldo)}. `
      + `Ahorras ${formatEurosRedondo(ahorro)} al mes, ${formatEurosRedondo(ahorro * 12)} al año.`
}
