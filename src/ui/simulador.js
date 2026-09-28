// @ts-check
/**
 * El reparto del mes: en qué decides tú que se va el día a día.
 *
 * Lo fijo y lo variable no se tocan igual y por eso no se enseñan igual: los
 * recibos no tienen barra, porque para dejar de pagar Netflix no se mueve un
 * deslizador, se da de baja. Lo que sí se puede decidir mañana por la mañana
 * —la compra, los bares, la gasolina— lleva barra.
 *
 * Esto era un simulacro: las barras movían una cifra y al refrescar se
 * olvidaban. Ahora lo que repartes aquí se guarda y es lo que mueve la
 * previsión y la bajamar. El histórico deja de mandar y pasa a ser la
 * propuesta de partida.
 *
 * El reparto es de arriba abajo: hay un residuo y se trocea. Subir una barra
 * consume de «sin repartir», y cuando no queda, la barra no sube más. Lo que
 * no se hace es encoger las otras categorías por tu cuenta para que cuadre:
 * eso sería la aplicación gastando tu dinero por ti.
 */

import { formatEuros, formatEurosRedondo } from '../dominio/dinero.js'
import { proyectar } from '../analisis/bajamar.js'
import { proponerAsignado, ritmoDelPlan } from '../analisis/plan.js'
import { ultimoDiaDelMes } from '../dominio/tipos.js'
import { CATEGORIAS } from '../entidades/semillas.js'
import { nodo, requerir } from './piezas.js'

/**
 * @typedef {ReturnType<typeof import('../estado.js').construirEstado>} Estado
 */

/** Por debajo de esto una barra no decide nada y sólo alarga la lista. */
const MINIMO_AL_MES = 500

/** Cinco euros: más fino que eso no es una decisión, es temblor de pulso. */
const PASO = 500

/**
 * Gasto real que no se reparte decidiéndolo. La liquidación de la tarjeta es la
 * factura de lo que ya compraste, y lo que compraste ya está repartido en sus
 * categorías: ponerle barra sería ofrecer recortar dos veces el mismo dinero.
 */
const SIN_BARRA = new Set(['tarjeta'])

/** Lo que se está repartiendo ahora mismo: categoría → céntimos positivos. */
/** @type {Record<string, number>} */
let borrador = {}

/** @type {Estado | null} */
let ultimo = null

/** @type {{ alAsignar: Function, alRecuadrar: Function } | null} */
let ganchos = null

export function montarSimulador({ alApagarCategoria, alAsignar, alRecuadrar }) {
  ganchos = { alAsignar, alRecuadrar }

  // Mientras arrastras sólo se recalcula; se guarda al soltar. Escribir en cada
  // píxel del recorrido llenaría la base de datos de estados intermedios que no
  // has decidido.
  requerir('simulador').addEventListener('input', (e) => {
    const barra = e.target
    if (!(barra instanceof HTMLInputElement) || !barra.dataset.categoria) return
    borrador[barra.dataset.categoria] = Number(barra.value)
    ofrecerApagar(barra)
    if (ultimo) refrescarCifras(ultimo)
  })

  requerir('simulador').addEventListener('change', async (e) => {
    const barra = e.target
    if (!(barra instanceof HTMLInputElement) || !barra.dataset.categoria) return
    await alAsignar(barra.dataset.categoria, Number(barra.value))
  })

  requerir('simulador').addEventListener('change', (e) => {
    const casilla = e.target
    if (!(casilla instanceof HTMLInputElement) || !casilla.dataset.apagar) return
    // La categoría entera sale del goteo: no es que gastes menos en ella, es
    // que no toca. Lo repartido ahí deja de tener sentido.
    delete borrador[casilla.dataset.apagar]
    alApagarCategoria(casilla.dataset.apagar, casilla.checked)
  })

  requerir('simulador-reset').addEventListener('click', async () => {
    if (!ultimo) return
    await alRecuadrar(proponerAsignado(ultimo.ordinarios, {
      habitualPorMes: ultimo.ritmo.porMes,
      residuo: ultimo.residuo,
    }))
  })
}

/** @param {Estado} estado */
export function pintarSimulador(estado) {
  ultimo = estado
  const lista = requerir('simulador')
  const apagadas = estado.apagadas.map((c) => apagada(c))

  borrador = repartoDePartida(estado)
  const conBarra = Object.keys(borrador)

  if (conBarra.length === 0) {
    lista.replaceChildren(cabeceraDelCuadre(estado), ...apagadas)
    requerir('simulador-pie').textContent = estado.residuo <= 0
      ? 'Este mes no queda nada que repartir para el día a día.'
      : 'Aún no hay meses cerrados suficientes para proponerte un reparto.'
    refrescarCifras(estado)
    return
  }

  const sinRepartir = estado.residuo - repartido()
  lista.replaceChildren(
    cabeceraDelCuadre(estado),
    ...conBarra.map((categoria) => palanca(categoria, sinRepartir)),
    ...apagadas,
  )

  requerir('simulador-pie').textContent = estado.plan
    ? 'Las barras reparten lo que te queda para el día a día, no los recibos. '
      + 'Lo que dejes sin repartir no te lo gastas: sube tu punto más bajo.'
    : 'Esto es una propuesta hecha con lo que sueles gastar. En cuanto muevas '
      + 'una barra pasa a ser tu plan del mes y manda sobre la previsión.'

  refrescarCifras(estado)
}

/**
 * De dónde salen las barras: de tu plan si lo hay, y si no de una propuesta
 * hecha con lo que sueles gastar, ajustada al residuo de este mes.
 * @param {Estado} estado
 */
function repartoDePartida(estado) {
  const crudo = estado.plan
    ? { ...estado.plan.asignado }
    : proponerAsignado(estado.ordinarios, {
      habitualPorMes: estado.ritmo.porMes,
      residuo: estado.residuo,
    })

  /** @type {Record<string, number>} */
  const limpio = {}
  for (const [categoria, importe] of Object.entries(crudo)) {
    if (SIN_BARRA.has(categoria)) continue
    if (estado.apagadas.includes(categoria)) continue
    if (importe < MINIMO_AL_MES && !estado.plan) continue
    limpio[categoria] = importe
  }
  return limpio
}

/** Lo repartido ahora mismo, en céntimos. */
function repartido() {
  return Object.values(borrador).reduce((t, x) => t + x, 0)
}

/**
 * La línea que dice cuánto queda suelto. Va la primera porque es la cifra
 * contra la que se mueve todo lo demás. El total del que sale ya está arriba,
 * en el escalón de la cascada que contiene esta lista.
 * @param {Estado} estado
 */
function cabeceraDelCuadre(estado) {
  const li = nodo('li', 'palanca palanca-fija')
  const sobrante = nodo('p', 'mes-aviso')
  sobrante.dataset.cifra = ':sinRepartir'
  li.append(sobrante)

  // El desajuste no se corrige solo: se enseña y decides tú. Si el residuo ha
  // cambiado desde que repartiste, es porque ha pasado algo que merece mirarse.
  if (estado.plan && estado.cuadre.desajuste !== 0) {
    const aviso = nodo('p', 'mes-aviso')
    const signo = estado.cuadre.desajuste < 0 ? 'bajado' : 'subido'
    aviso.textContent = `Lo que te queda ha ${signo} ${formatEuros(Math.abs(estado.cuadre.desajuste))} `
      + 'desde que repartiste. Tus cifras siguen como las dejaste.'
    const boton = document.createElement('button')
    boton.type = 'button'
    boton.className = 'boton boton-sobrio'
    boton.textContent = 'Recuadrar en proporción'
    boton.addEventListener('click', async () => {
      if (ultimo?.plan && ganchos) await ganchos.alRecuadrar(null)
    })
    li.append(aviso, boton)
  }
  return li
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
 * El interruptor no está siempre: diecinueve casillas repetidas taparían la
 * lista y nadie apaga una categoría sin haber mirado antes qué pasa si la
 * recorta. Aparece cuando la barra llega a cero, que es justo cuando el usuario
 * acaba de decir «en esto no voy a gastar».
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
 * @param {string} categoria
 * @param {number} sinRepartir  lo que queda suelto, para saber hasta dónde sube
 */
function palanca(categoria, sinRepartir) {
  const li = nodo('li', 'palanca')
  const nombre = CATEGORIAS[categoria] ?? categoria

  const cabecera = nodo('div', 'mes-cabecera')
  cabecera.append(nodo('span', 'mes-nombre', nombre))
  const cifra = nodo('span', 'cifras')
  cifra.dataset.cifra = categoria
  cabecera.append(cifra)
  li.append(cabecera)

  const barra = document.createElement('input')
  barra.type = 'range'
  barra.min = '0'
  barra.step = String(PASO)
  // El techo va antes que el valor: un range nace con max 100, y asignarle
  // primero el importe en céntimos lo recortaría a cero sin avisar.
  barra.max = String((borrador[categoria] ?? 0) + Math.max(sinRepartir, 0))
  barra.value = String(borrador[categoria] ?? 0)
  // El paso redondea el valor que acabamos de poner. Se relee para que la
  // cifra de al lado diga exactamente lo mismo que la barra.
  borrador[categoria] = Number(barra.value)
  barra.dataset.categoria = categoria
  barra.setAttribute('aria-label', `Cuánto repartes a ${nombre}`)
  li.append(barra)
  if (barra.value === '0') li.append(interruptor(categoria, nombre, false))
  return li
}

/**
 * La cuenta del módulo: lo repartido marca el ritmo, el ritmo marca el suelo, y
 * el techo de cada barra es lo suyo más lo que quede sin repartir —que es lo
 * que impide repartir más de lo que hay sin decidir de dónde sale—.
 * @param {Estado} estado
 */
function refrescarCifras(estado) {
  const lista = requerir('simulador')
  const sinRepartir = estado.residuo - repartido()

  for (const [categoria, importe] of Object.entries(borrador)) {
    const cifra = lista.querySelector(`[data-cifra="${categoria}"]`)
    if (cifra) cifra.textContent = formatEuros(-importe)
    const barra = lista.querySelector(`[data-categoria="${categoria}"]`)
    if (barra instanceof HTMLInputElement) {
      barra.max = String(importe + Math.max(sinRepartir, 0))
    }
  }

  const suelto = lista.querySelector('[data-cifra=":sinRepartir"]')
  if (suelto) {
    suelto.textContent = sinRepartir < 0
      ? `Te has pasado ${formatEuros(-sinRepartir)}: quita de algún sitio antes de seguir.`
      : `Sin repartir: ${formatEuros(sinRepartir)}. Lo que dejes aquí no te lo gastas.`
  }

  const delMes = estado.periodoActual
  const gastado = Object.fromEntries((delMes?.lineas ?? []).map((l) => [l.id, l.gastado]))
  const mes = estado.periodoActual?.id ?? ''
  const finDeMes = estado.periodoActual?.hasta ?? ultimoDiaDelMes(estado.hoy)
  const ritmo = ritmoDelPlan({
    plan: { mes, asignado: borrador, residuo: estado.residuo, sello: estado.hoy },
    gastado,
    hoy: estado.hoy,
    hasta: estado.periodoActual?.hasta ?? finDeMes,
  })

  const nueva = proyectar({
    saldoInicial: estado.saldoInicial,
    desde: estado.hoy,
    hasta: estado.proyeccion.hasta,
    eventos: estado.proyeccion.eventos,
    // Igual que en el estado: el plan manda dentro de su mes y ni un día más.
    ritmoPorDia: (/** @type {string} */ fecha) =>
      (fecha <= finDeMes ? (ritmo?.porDia ?? 0) : estado.ritmo.porDia),
  })

  // Se compara mes entero contra mes entero: lo que sueles gastar frente a lo
  // que has repartido. El ritmo del plan mide lo que queda de mes, que a día 20
  // es otra cosa, y mezclarlos diría que ahorras cada vez que avanza el mes.
  const ahorro = Math.abs(estado.ritmo.porMes) - repartido()
  requerir('simulador-suelo').textContent = formatEurosRedondo(nueva.suelo.saldo)
  requerir('simulador-reset').hidden = false
  requerir('simulador-reset').textContent = 'Repartir como sueles gastar'

  requerir('simulador-efecto').textContent = Math.abs(ahorro) < 100
    ? 'Mueve una barra y verás moverse dos cosas: tu punto más bajo y lo que te llevas al año.'
    : ahorro > 0
      ? `Tu punto más bajo pasa de ${formatEurosRedondo(estado.proyeccion.suelo.saldo)} `
        + `a ${formatEurosRedondo(nueva.suelo.saldo)}. `
        + `Ahorras ${formatEurosRedondo(ahorro)} al mes, ${formatEurosRedondo(ahorro * 12)} al año.`
      : `Estás repartiendo ${formatEurosRedondo(-ahorro)} al mes más de lo que sueles gastar. `
        + `Tu punto más bajo queda en ${formatEurosRedondo(nueva.suelo.saldo)}.`
}
