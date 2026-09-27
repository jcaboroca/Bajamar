// @ts-check
/**
 * Resumen: las seis preguntas contestadas sin tener que buscar nada.
 *
 * El orden no es decorativo. Primero lo que hay que saber hoy —si algo va mal
 * y cuándo llega el punto bajo—, después de dónde sale ese número y sólo al
 * final el detalle. Quien abre la aplicación de paso ve lo primero y cierra;
 * quien tiene un rato baja.
 */

import { formatEuros, formatEurosRedondo } from '../../dominio/dinero.js'
import { diasEntre, fechaLarga } from '../../dominio/tipos.js'
import { totalesPorCategoria } from '../../estado.js'
import { dibujarLamina } from '../lamina.js'
import { barra, cuentas, diaYMes, linea, nodo, requerir, titular, vacio } from '../piezas.js'
import { marcarPreguntable, preguntarAlPulsar, rotuloDe } from '../trato.js'

/**
 * @typedef {ReturnType<typeof import('../../estado.js').construirEstado>} Estado
 */

/** @type {Estado | null} */
let ultimo = null

/** @param {{ alCambiarTrato: (entidadId: string, trato: import('../trato.js').Trato) => unknown, alMarcarAnual: (entidadId: string, esAnual: boolean) => Promise<void> }} ganchos */
export function montarResumen({ alCambiarTrato, alMarcarAnual }) {
  for (const caja of ['eventos', 'avisos']) {
    preguntarAlPulsar(requerir(caja), () => ultimo, alCambiarTrato)
  }

  requerir('preguntas').addEventListener('change', (e) => {
    const casilla = e.target
    if (!(casilla instanceof HTMLInputElement) || !casilla.dataset.anual) return
    alMarcarAnual(casilla.dataset.anual, casilla.checked)
  })
}

/**
 * @param {Estado} estado
 * @param {{ animar: boolean }} opciones
 */
export function pintarResumen(estado, { animar }) {
  ultimo = estado
  const { proyeccion } = estado

  const cifra = requerir('suelo-cifra')
  cifra.replaceChildren(...titular(formatEurosRedondo(proyeccion.suelo.saldo)))
  cifra.parentElement?.classList.toggle('en-rojo', proyeccion.suelo.saldo < 0)

  const faltan = diasEntre(estado.hoy, proyeccion.suelo.fecha)
  const pie = requerir('suelo-pie')
  pie.replaceChildren(...(faltan <= 0
    ? [document.createTextNode('Hoy mismo es el punto más bajo del periodo.')]
    : [
        document.createTextNode('el '),
        nodo('strong', '', fechaLarga(proyeccion.suelo.fecha)),
        document.createTextNode(`, dentro de ${faltan} ${faltan === 1 ? 'día' : 'días'}. `),
        document.createTextNode(`Cierras el periodo con ${formatEurosRedondo(proyeccion.saldoFinal)}.`),
      ]))

  // El margen sólo es noticia si de verdad mueve el suelo. Decir «ganarías
  // 3 €» sería ruido con forma de consejo.
  const margen = estado.margen
  const alivio = requerir('suelo-margen')
  alivio.hidden = margen === null || margen.gana < 5000
  if (margen !== null && !alivio.hidden) {
    alivio.textContent = proyeccion.suelo.saldo < 0
      ? `Si te saltas lo que puedes saltarte, el suelo sube a ${formatEurosRedondo(margen.suelo.saldo)}.`
      : `Tienes ${formatEurosRedondo(margen.gana)} más de margen si te saltas lo que puedes saltarte.`
  }

  const lamina = requerir('lamina')
  lamina.replaceChildren(dibujarLamina(proyeccion))
  lamina.classList.remove('dibujando')
  if (animar) {
    void lamina.offsetWidth // reiniciar la animación sin esperar a un cuadro
    lamina.classList.add('dibujando')
  }

  pintarAvisos(estado)
  pintarDisponible(estado)
  pintarMes(estado)
  pintarEventos(estado)
  pintarPreguntas(estado)
  pintarCategorias(estado)
  pintarCapacidad(estado)
}

/** @param {Estado} estado */
function pintarAvisos(estado) {
  const bloque = requerir('bloque-avisos')
  bloque.hidden = estado.avisos.length === 0
  requerir('avisos').replaceChildren(...estado.avisos.slice(0, 4).map((a) => {
    const li = nodo('li', `aviso aviso-${a.nivel}`)
    li.append(nodo('p', 'aviso-titulo', a.titulo), nodo('p', 'aviso-detalle', a.detalle))
    if (a.reciboId) marcarPreguntable(li, a.reciboId)
    return li
  }))
}

/** @param {Estado} estado */
function pintarDisponible(estado) {
  const d = estado.disponible
  const caja = requerir('disponible')
  caja.replaceChildren()

  caja.append(cuentas([
    ['Saldo de hoy', formatEuros(d.saldo)],
    ...(d.porCobrar !== 0 ? /** @type {Array<[string, string]>} */ ([['Lo que entra', formatEuros(d.porCobrar, { signo: true })]]) : []),
    ...(d.porPagar !== 0 ? /** @type {Array<[string, string]>} */ ([['Recibos pendientes', formatEuros(d.porPagar)]]) : []),
    ...(d.goteo !== 0 ? /** @type {Array<[string, string]>} */ ([['Gasto del día a día', formatEuros(d.goteo)]]) : []),
  ]))

  const total = nodo('p', 'subtitular')
  total.append(...titular(formatEurosRedondo(d.total)))
  if (d.total < 0) total.classList.add('en-rojo')
  caja.append(total, nodo('p', 'pie pie-menor', 'es lo que te queda libre hasta fin de mes'))
}

/** @param {Estado} estado */
function pintarMes(estado) {
  const m = estado.mesEnCurso
  const caja = requerir('mes-resumen')

  /**
   * @param {string} titulo
   * @param {import('../../analisis/mes.js').Mitad} mitad
   */
  const tramo = (titulo, mitad) => {
    const div = nodo('div', 'tramo')
    div.append(
      nodo('p', 'tramo-rotulo', titulo),
      nodo('p', 'tramo-cifra cifras', formatEuros(mitad.total)),
      nodo('p', 'tramo-detalle', mitad.previsto === 0
        ? 'todo confirmado'
        : `${formatEuros(mitad.real)} hasta hoy · ${formatEuros(mitad.previsto)} previsto`),
    )
    return div
  }

  const ahorro = nodo('div', 'tramo')
  ahorro.append(
    nodo('p', 'tramo-rotulo', 'Ahorro del mes'),
    nodo('p', `tramo-cifra cifras${m.ahorro < 0 ? ' en-rojo' : ''}`, formatEuros(m.ahorro)),
    nodo('p', 'tramo-detalle', m.apartado !== 0
      ? `y ${formatEuros(Math.abs(m.apartado))} movidos a tus cuentas de ahorro`
      : 'lo que sobra al cerrar el mes'),
  )

  caja.replaceChildren(tramo('Ingresos', m.ingresos), tramo('Gastos', m.gastos), ahorro)
}

/** @param {Estado} estado */
function pintarEventos(estado) {
  const lista = requerir('eventos')
  if (estado.proyeccion.eventos.length === 0) {
    lista.replaceChildren(vacio('No hay nada previsto en este periodo.'))
    return
  }
  lista.replaceChildren(...estado.proyeccion.eventos.map((e) => {
    const clase = [e.seguro ? 'confirmado' : 'previsto']
    // Ámbar sólo para lo que cae en los próximos tres días: si se pintara
    // todo lo llamativo, no quedaría forma de llamar la atención.
    if (diasEntre(estado.hoy, e.fecha) <= 3 && e.importe < 0) clase.push('urgente')
    const fila = linea({
      marca: diaYMes(e.fecha),
      nombre: e.nombre,
      detalle: e.seguro ? 'confirmado' : 'previsto',
      importe: formatEuros(e.importe, { signo: true }),
      clase: clase.join(' '),
    })
    if (e.reciboId) marcarPreguntable(fila, e.reciboId, rotuloDe(e.reciboId, e.nombre, e.importe))
    return fila
  }))
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
 * ese es justo el dato que el usuario tiene y ella no. Hasta ahora la pregunta
 * se hacía sin dejar contestarla.
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

/** @param {Estado} estado */
function pintarCategorias(estado) {
  const desde = `${Number(estado.hoy.slice(0, 4)) - 1}${estado.hoy.slice(4, 7)}-01`
  const totales = totalesPorCategoria(estado.movimientos, estado.categorias, { desde })
  const mayor = Math.abs(totales[0]?.total ?? 1)
  const lista = requerir('categorias')

  if (totales.length === 0) {
    lista.replaceChildren(vacio('Todavía no hay un año de movimientos con el que hacer una media.'))
    return
  }

  lista.replaceChildren(...totales.slice(0, 12).map((c) => {
    const li = nodo('li')
    li.append(
      nodo('span', '', c.nombre),
      nodo('span', 'evento-importe', formatEurosRedondo(Math.round(c.total / 12))),
      barra((Math.abs(c.total) / mayor) * 100),
    )
    return li
  }))
}

/** @param {Estado} estado */
function pintarCapacidad(estado) {
  const c = estado.capacidad
  const caja = requerir('capacidad')

  if (c.ingresos === 0) {
    caja.replaceChildren(vacio(
      'Todavía no he reconocido ningún ingreso que se repita. Con dos o tres nóminas '
      + 'seguidas podré decirte cuánto te sobra cada mes.',
    ))
    return
  }

  caja.replaceChildren(
    cuentas([
      ['Ingresos', formatEuros(c.ingresos, { signo: true })],
      ['Gastos fijos', formatEuros(c.fijos)],
      ['Día a día', formatEuros(c.ordinario)],
      ['Reserva para los anuales', formatEuros(c.reserva)],
    ]),
  )

  const total = nodo('p', 'subtitular')
  total.append(...titular(formatEurosRedondo(c.capacidad)))
  if (c.capacidad < 0) total.classList.add('en-rojo')
  caja.append(total, nodo('p', 'pie pie-menor', c.capacidad > 0
    ? 'al mes, sin tocar nada de lo que ya tienes comprometido'
    : 'tu vida cuesta más de lo que entra: los anuales salen de lo ahorrado'))
}
