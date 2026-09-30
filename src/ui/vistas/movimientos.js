// @ts-check
/**
 * Movimientos: la lista completa, y la única pantalla donde se corrige.
 *
 * Corregir algo aquí tiene dos alcances posibles y la diferencia importa
 * mucho. Cambiar la categoría de un apunte arregla ese apunte; marcar «y todos
 * los de este comercio» crea una regla que vale para los que vengan. Lo
 * segundo es lo que hace que la aplicación aprenda, pero si fuera lo único, un
 * error puntual contaminaría el histórico entero.
 */

import { formatEuros } from '../../dominio/dinero.js'
import { CATEGORIAS } from '../../entidades/semillas.js'
import { diaYMes, linea, nodo, nombreDeMes, requerir, vacio, fechaLarga } from '../piezas.js'

/**
 * @typedef {import('../../dominio/tipos.js').Movimiento} Movimiento
 * @typedef {ReturnType<typeof import('../../estado.js').construirEstado>} Estado
 */

const POR_TANDA = 60

/** @type {'todos' | 'gastos' | 'ingresos' | 'traspasos' | 'recurrentes' | 'tarjeta'} */
let filtro = 'todos'
let busqueda = ''
let visibles = POR_TANDA

/** @type {Estado | null} */
let ultimo = null

/** @type {(cambio: { retoque?: import('../../dominio/tipos.js').Retoque, regla?: [string, string | null] }) => Promise<void>} */
let avisarCambio = async () => {}

/**
 * @param {object} enganches
 * @param {typeof avisarCambio} enganches.alCambiar
 */
export function montarMovimientos({ alCambiar }) {
  avisarCambio = alCambiar

  const buscar = requerir('buscar')
  if (buscar instanceof HTMLInputElement) {
    buscar.addEventListener('input', () => {
      busqueda = buscar.value.trim().toLowerCase()
      visibles = POR_TANDA
      repintar()
    })
  }

  requerir('filtros').addEventListener('click', (e) => {
    const boton = e.target instanceof Element ? e.target.closest('[data-filtro]') : null
    if (!(boton instanceof HTMLButtonElement)) return
    filtro = /** @type {typeof filtro} */ (boton.dataset.filtro ?? 'todos')
    visibles = POR_TANDA
    for (const otro of requerir('filtros').querySelectorAll('[data-filtro]')) {
      otro.setAttribute('aria-pressed', String(otro === boton))
    }
    repintar()
  })

  requerir('movimientos-mas').addEventListener('click', () => {
    visibles += POR_TANDA
    repintar()
  })

  requerir('movimientos-lista').addEventListener('click', (e) => {
    const li = e.target instanceof Element ? e.target.closest('li[data-id]') : null
    if (!(li instanceof HTMLElement) || !ultimo) return
    const movimiento = ultimo.movimientos.find((m) => m.id === li.dataset.id)
    if (movimiento) abrirDetalle(movimiento, ultimo)
  })

  requerir('detalle-cerrar').addEventListener('click', () => cerrar())
}

function cerrar() {
  const hoja = document.getElementById('detalle')
  if (hoja instanceof HTMLDialogElement) hoja.close()
}

/** @param {Estado} estado */
export function pintarMovimientos(estado) {
  ultimo = estado
  repintar()
}

function repintar() {
  if (!ultimo) return
  const estado = ultimo
  const recurrentes = new Set(estado.fijos.map((f) => f.entidadId))

  const elegidos = estado.movimientos
    .filter((m) => encaja(m, recurrentes))
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || a.importe - b.importe)

  const cuenta = requerir('movimientos-cuenta')
  const suma = elegidos.reduce((t, m) => t + m.importe, 0)
  cuenta.textContent = elegidos.length === 0
    ? ''
    : `${elegidos.length} ${elegidos.length === 1 ? 'movimiento' : 'movimientos'} · ${formatEuros(suma, { signo: true })}`
  if (filtro === 'tarjeta') cuenta.textContent = loQueDebesALaTarjeta(estado)

  const lista = requerir('movimientos-lista')
  if (elegidos.length === 0) {
    lista.replaceChildren(vacio(busqueda
      ? `Nada que coincida con «${busqueda}».`
      : 'No hay movimientos con ese filtro.'))
    requerir('movimientos-mas').hidden = true
    return
  }

  const tanda = elegidos.slice(0, visibles)
  /** @type {Node[]} */
  const nodos = []
  let mesAnterior = ''
  for (const m of tanda) {
    const mes = m.fecha.slice(0, 7)
    if (mes !== mesAnterior) {
      mesAnterior = mes
      nodos.push(nodo('li', 'separador', `${nombreDeMes(mes)} de ${mes.slice(0, 4)}`))
    }
    nodos.push(fila(m, estado))
  }

  lista.replaceChildren(...nodos)
  const mas = requerir('movimientos-mas')
  mas.hidden = tanda.length >= elegidos.length
  mas.textContent = `Ver ${Math.min(POR_TANDA, elegidos.length - tanda.length)} más`
}

/**
 * La pregunta al mirar la tarjeta no es cuánto has gastado con ella en total,
 * sino cuánto te va a cobrar el banco y cuándo.
 * @param {Estado} estado
 */
function loQueDebesALaTarjeta(estado) {
  const pagado = estado.tarjetaPagadaHasta
    ? ` Lo de hasta el ${diaYMes(estado.tarjetaPagadaHasta)} ya te lo cobraron.`
    : ''
  if (!estado.cargoTarjeta) return `No debes nada a la tarjeta.${pagado}`
  return `Te cobrarán ${formatEuros(Math.abs(estado.cargoTarjeta.importe))} el ${diaYMes(estado.cargoTarjeta.fecha)}.${pagado}`
}

/**
 * @param {Movimiento} m
 * @param {Set<string>} recurrentes
 */
function encaja(m, recurrentes) {
  if (busqueda && !`${m.conceptoRaw} ${m.categoria ?? ''}`.toLowerCase().includes(busqueda)) return false
  switch (filtro) {
    case 'gastos': return m.importe < 0 && m.categoria !== 'traspaso'
    case 'ingresos': return m.importe > 0 && m.categoria !== 'traspaso'
    case 'traspasos': return m.categoria === 'traspaso'
    case 'recurrentes': return m.entidadId !== null && recurrentes.has(m.entidadId)
    case 'tarjeta': return m.origen === 'tarjeta'
    default: return true
  }
}

/**
 * @param {Movimiento} m
 * @param {Estado} estado
 */
function fila(m, estado) {
  const detalles = [CATEGORIAS[m.categoria ?? 'otros'] ?? 'Sin clasificar']
  const porCobrar = m.origen === 'tarjeta' && m.fecha > (estado.tarjetaPagadaHasta ?? '')
  if (m.origen === 'tarjeta') detalles.push(porCobrar ? 'tarjeta, aún por cobrar' : 'tarjeta')
  if (m.excluido) detalles.push('excluido')
  if (m.nota) detalles.push(m.nota)

  const li = linea({
    marca: m.fecha.slice(8, 10),
    nombre: (m.entidadId && estado.nombres.get(m.entidadId)) || m.conceptoRaw,
    detalle: detalles.join(' · '),
    importe: formatEuros(m.importe, { signo: true }),
    clase: `${m.importe > 0 ? 'entrada' : ''} ${m.excluido ? 'apagado' : ''} ${porCobrar ? 'por-cobrar' : ''}`.trim(),
  })
  li.dataset.id = m.id
  li.tabIndex = 0
  li.setAttribute('role', 'button')
  li.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      li.click()
    }
  })
  return li
}

/**
 * @param {Movimiento} m
 * @param {Estado} estado
 */
function abrirDetalle(m, estado) {
  const hoja = document.getElementById('detalle')
  if (!(hoja instanceof HTMLDialogElement)) return
  const cuerpo = requerir('detalle-cuerpo')

  const nombre = (m.entidadId && estado.nombres.get(m.entidadId)) || m.conceptoRaw
  const cabecera = nodo('div', 'detalle-cabecera')
  cabecera.append(
    nodo('p', 'rotulo', 'Movimiento'),
    nodo('p', 'detalle-nombre', nombre),
    nodo('p', `detalle-importe cifras${m.importe < 0 ? '' : ' entrada'}`, formatEuros(m.importe, { signo: true })),
    nodo('p', 'detalle-fecha', `${fechaLarga(m.fecha)}${m.localidad ? ` · ${m.localidad}` : ''}${m.origen === 'tarjeta' ? ' · tarjeta' : ''}`),
    nodo('p', 'detalle-crudo', m.conceptoRaw),
  )

  const categoria = document.createElement('select')
  categoria.className = 'campo'
  categoria.setAttribute('aria-label', 'Categoría')
  for (const [id, texto] of Object.entries(CATEGORIAS)) {
    const opcion = document.createElement('option')
    opcion.value = id
    opcion.textContent = texto
    if (id === (m.categoria ?? 'otros')) opcion.selected = true
    categoria.append(opcion)
  }

  const paraTodos = casilla('Y para todos los de este comercio', false)
  paraTodos.hidden = !m.entidadId

  const excluir = casilla('No contar este movimiento', m.excluido === true)
  const traspaso = casilla('Es dinero entre cuentas mías', m.categoria === 'traspaso')

  const nota = document.createElement('input')
  nota.type = 'text'
  nota.className = 'campo'
  nota.placeholder = 'Una nota, si hace falta'
  nota.setAttribute('aria-label', 'Nota')
  nota.value = m.nota ?? ''

  const guardar = nodo('button', 'boton', 'Guardar')
  guardar.setAttribute('type', 'button')
  guardar.addEventListener('click', async () => {
    const elegida = categoria.value
    /** @type {import('../../dominio/tipos.js').Retoque} */
    const retoque = { id: m.id }
    const marcaTraspaso = dentro(traspaso)
    if (marcaTraspaso) retoque.traspaso = true
    else if (elegida !== (m.categoria ?? 'otros')) retoque.categoria = elegida
    if (dentro(excluir)) retoque.excluido = true
    if (nota.value.trim()) retoque.nota = nota.value.trim()

    const regla = dentro(paraTodos) && m.entidadId && !marcaTraspaso
      ? /** @type {[string, string]} */ ([m.entidadId, elegida])
      : undefined

    hoja.close()
    await avisarCambio({ retoque, regla })
  })

  const campos = nodo('div', 'detalle-campos')
  campos.append(
    nodo('p', 'rotulo rotulo-menor', 'Categoría'),
    categoria,
    paraTodos,
    traspaso,
    excluir,
    nota,
    (() => {
      // «Cerrar» vive en el HTML del diálogo, pero tiene que leerse al lado de
      // «Guardar», no debajo y suelto: son la misma decisión. Moverlo aquí
      // conserva su escuchador y evita duplicar el botón.
      const caja = nodo('div', 'acciones')
      caja.append(guardar, requerir('detalle-cerrar'))
      return caja
    })(),
  )

  cuerpo.replaceChildren(cabecera, campos)
  hoja.showModal()
}

/**
 * @param {string} texto
 * @param {boolean} marcada
 */
function casilla(texto, marcada) {
  const label = nodo('label', 'recordar')
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.checked = marcada
  label.append(input, document.createTextNode(` ${texto}`))
  return label
}

/** @param {HTMLElement} label */
function dentro(label) {
  const input = label.querySelector('input')
  return input instanceof HTMLInputElement && input.checked
}
