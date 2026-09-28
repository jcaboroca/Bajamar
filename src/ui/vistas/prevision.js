// @ts-check
/**
 * Previsión: qué viene y cuánto cuesta que venga.
 *
 * Aquí conviven dos maneras de mirar el mismo dinero. Mes a mes se ve la
 * forma del año —dónde hay un mes que no cuadra— y día a día se ve por qué.
 * Un mes puede cerrar en positivo y aun así haber pasado por un descubierto el
 * día 12, así que cada mes lleva su propio suelo además de su saldo final.
 *
 * Cuanto más lejos se mira, menos se sabe. Lo que hay a doce meses son
 * recibos que se repiten y un ritmo de gasto medido, no una bola de cristal, y
 * el pie de la lámina lo dice con esas palabras.
 */

import { formatEuros, formatEurosRedondo } from '../../dominio/dinero.js'
import { diasEntre, mesDe, ultimoDiaDelMes, sumarMeses } from '../../dominio/tipos.js'
import { MESES_DE } from '../../analisis/fijos.js'
import { dibujarLamina } from '../lamina.js'
import { montarSimulador, pintarSimulador } from '../simulador.js'
import { diaYMes, linea, nodo, nombreDeMes, requerir, vacio } from '../piezas.js'
import { marcarPreguntable, preguntarAlPulsar, rotuloDe } from '../trato.js'

/**
 * @typedef {ReturnType<typeof import('../../estado.js').construirEstado>} Estado
 * @typedef {import('../../analisis/bajamar.js').Proyeccion} Proyeccion
 */

let horizonte = 3

/** @type {Estado | null} */
let ultimo = null

export function montarPrevision({ alCambiarTrato, alApagarCategoria, alMarcarInversion, alSaltarCobro, alAsignar, alRecuadrar, alMarcarAnual }) {
  // «No lo sé» vive aquí, con los fijos y los apartados: es la misma familia
  // de preguntas sobre recibos, y en el Resumen era una bandeja de tareas
  // disfrazada de resumen.
  requerir('preguntas').addEventListener('change', (e) => {
    const casilla = e.target
    if (!(casilla instanceof HTMLInputElement) || !casilla.dataset.anual) return
    alMarcarAnual(casilla.dataset.anual, casilla.checked)
  })
  montarSimulador({ alApagarCategoria, alAsignar, alRecuadrar })
  for (const caja of ['fijos', 'apartados', 'cascada']) {
    preguntarAlPulsar(requerir(caja), () => ultimo, alCambiarTrato)
  }
  requerir('cascada').addEventListener('change', (ev) => {
    const casilla = /** @type {HTMLInputElement} */ (ev.target)
    if (!casilla.dataset.inversion) return
    alMarcarInversion(casilla.dataset.inversion, casilla.checked)
  })
  requerir('cascada').addEventListener('click', (ev) => {
    const boton = ev.target instanceof Element ? ev.target.closest('[data-saltar]') : null
    if (!(boton instanceof HTMLElement) || !boton.dataset.saltar || !boton.dataset.mes) return
    alSaltarCobro(boton.dataset.saltar, boton.dataset.mes, boton.dataset.puesto !== 'si')
  })
  for (const caja of ['fijos', 'apartados']) {
    preguntarAlPulsar(requerir(caja), () => ultimo, alCambiarTrato)
  }

  requerir('horizonte').addEventListener('click', (e) => {
    const boton = e.target instanceof Element ? e.target.closest('[data-meses]') : null
    if (!(boton instanceof HTMLButtonElement)) return
    horizonte = Number(boton.dataset.meses)
    for (const otro of requerir('horizonte').querySelectorAll('[data-meses]')) {
      otro.setAttribute('aria-pressed', String(otro === boton))
    }
    repintar()
  })
}

/** @param {Estado} estado */
export function pintarPrevision(estado) {
  ultimo = estado
  repintar()
}

function repintar() {
  if (!ultimo) return
  const estado = ultimo
  const hasta = ultimoDiaDelMes(sumarMeses(estado.hoy, horizonte - 1))
  const proyeccion = recortar(estado.proyeccionLarga, hasta)

  requerir('lamina-larga').replaceChildren(dibujarLamina(proyeccion, { marca: 'largo' }))

  requerir('prevision-pie').textContent =
    `El suelo de estos ${horizonte} meses es ${formatEurosRedondo(proyeccion.suelo.saldo)}. `
    + 'De aquí en adelante sólo hay recibos que se repiten y tu ritmo de gasto medido: '
    + 'cuanto más lejos, menos seguro.'

  pintarCascada(estado)
  pintarSimulador(estado)
  pintarFijos(estado)
  pintarApartados(estado)
  pintarSuscripciones(estado)
  pintarPreguntas(estado)
}

/**
 * @param {Proyeccion} proyeccion
 * @param {string} hasta
 * @returns {Proyeccion}
 */
function recortar(proyeccion, hasta) {
  const curva = proyeccion.curva.filter((p) => p.fecha <= hasta)
  if (curva.length === 0) return proyeccion
  const suelo = curva.reduce((bajo, p) => (p.saldo < bajo.saldo ? p : bajo), curva[0])
  return {
    ...proyeccion,
    hasta,
    curva,
    suelo: { ...suelo },
    saldoFinal: curva[curva.length - 1].saldo,
    eventos: proyeccion.eventos.filter((e) => e.fecha <= hasta),
  }
}
/**
 * El mes de arriba abajo: la nómina entera y de ella van saliendo cosas, en el
 * orden en que se deciden. Cada escalón deja a la derecha lo que queda, que es
 * la cifra que contesta «¿y entonces cuánto me sobra?».
 * @param {Estado} estado
 */
function pintarCascada(estado) {
  const c = estado.cascada
  const nombre = nombreDeMes(c.mes)
  requerir('cascada-rotulo').textContent = `Tu ${nombre.toLowerCase()}`
  requerir('cascada-entradilla').textContent = c.ingreso === 0
    ? 'Todavía no sé lo que cobras, así que esto es sólo lo que sale.'
    : `Cobras ${formatEuros(c.ingreso)} y con eso pagas del ${diaYMes(c.desde)} `
      + `al ${diaYMes(c.hasta)}.`

  let queda = c.apertura
  const filas = [encabezado('Vienes con', c.apertura, queda)]
  queda += c.ingreso
  filas.push(encabezado('Lo que cobras', c.ingreso, queda))

  /**
   * @param {string} titulo
   * @param {string} cuandoNoHay
   * @param {number} suma
   * @param {import('../../analisis/cascada.js').Escalon[]} lista
   */
  const escalon = (titulo, cuandoNoHay, suma, lista) => {
    queda += suma
    const li = encabezado(titulo, suma, queda)
    if (lista.length === 0) li.append(nodo('p', 'cascada-vacio', cuandoNoHay))
    else li.append(desglose(lista))
    filas.push(li)
  }

  // Todo lo que seguro que sale, junto y por día: los fijos de siempre, las
  // cuotas de lo aplazado y los recibos gordos que sólo caen este mes. Verlos
  // en tres montones no ayuda a decidir nada; el total sí.
  const seguros = [...c.fijos, ...c.plazos, ...c.toca]
    .sort((a, b) => (a.fecha ?? '').localeCompare(b.fecha ?? ''))
  escalon(
    `Gastos fijos de ${nombre.toLowerCase()}`,
    'Ninguno.',
    c.sumaFijos + c.sumaPlazos + c.sumaToca,
    seguros,
  )
  escalon('Inversiones', 'Este mes no apartas nada.', c.sumaInversiones, c.inversiones)

  filas.push(loQueQuedaParaVivir(queda, c))

  queda += c.diaADia
  const dia = encabezado('Día a día', c.diaADia, queda)
  // Las barras van aquí y no en un bloque aparte: se reparte en el mismo sitio
  // donde se ve cuánto queda por repartir.
  const reparto = requerir('reparto')
  reparto.hidden = false
  dia.append(reparto)
  filas.push(dia)

  filas.push(encabezado('Acabas con', c.cierre, null, c.cierre < 0))
  requerir('cascada').replaceChildren(...filas)

  pintarSaldoDelMes(estado)
  requerir('cascada-pie').textContent = margen(c)
}

/**
 * La cascada ya dice con cuánto llegas y con cuánto acabas. Lo que no dice es
 * por dónde pasa el punto más bajo, que no es el final del mes casi nunca.
 * @param {Estado} estado
 */
function pintarSaldoDelMes(estado) {
  const caja = requerir('cascada-saldo')
  const fila = estado.detalleMensual.find((m) => m.id === estado.cascada.mes)
  if (!fila) { caja.replaceChildren(); return }

  const bajo = nodo('p', `cascada-saldo-linea${fila.suelo.saldo < 0 ? ' alarma' : ''}`)
  bajo.textContent = `Tu punto más bajo: ${formatEurosRedondo(fila.suelo.saldo)} el ${diaYMes(fila.suelo.fecha)}.`
  caja.replaceChildren(bajo)
}

/**
 * @param {import('../../analisis/cascada.js').Cascada} c
 */
function margen(c) {
  const base = 'Toca cualquier línea para decirme qué es y si te la puedes saltar.'
  if (c.aplazable === 0) {
    return c.resultado < 0
      ? `Este mes sale más de lo que entra: la diferencia se la come el saldo que traías. ${base}`
      : `Las inversiones salen de la cuenta pero no se gastan: siguen siendo tuyas. ${base}`
  }
  return `Si este mes no traspasas lo que puedes saltarte, acabarías con `
    + `${formatEuros(c.cierre - c.aplazable)} en vez de ${formatEuros(c.cierre)}. ${base}`
}

/**
 * Lo que queda cuando ya ha salido todo lo que no se puede evitar. Es la única
 * cifra del mes sobre la que se decide algo, y estaba escondida como un
 * «quedan…» pequeño debajo de otro escalón.
 *
 * Se dice al día porque nadie sabe si 1.300 € es mucho, y todo el mundo sabe si
 * 42 € al día le dan de comer.
 *
 * @param {number} queda
 * @param {import('../../analisis/cascada.js').Cascada} c
 */
function loQueQuedaParaVivir(queda, c) {
  const dias = diasEntre(c.desde, c.hasta) + 1
  const alDia = Math.round(queda / dias)
  const ritmo = Math.round(Math.abs(c.diaADia) / dias)
  const apurado = alDia < ritmo

  const li = nodo('li', `cascada-fila cascada-vivir${queda < 0 || apurado ? ' alarma' : ''}`)
  const cabeza = nodo('div', 'cascada-cabeza')
  cabeza.append(
    nodo('span', 'cascada-titulo', 'Te queda para el día a día'),
    nodo('span', 'cascada-importe cifras', formatEuros(queda)),
  )
  li.append(cabeza)

  if (queda <= 0) {
    li.append(nodo('p', 'cascada-vivir-lectura', 'No queda nada. Todo lo que gastes sale del colchón.'))
    return li
  }
  li.append(nodo('p', 'cascada-vivir-lectura',
    `${formatEurosRedondo(alDia)} al día durante ${dias} días. `
    + (apurado
      ? `Sueles gastar ${formatEurosRedondo(ritmo)}, así que este mes toca apretar.`
      : `Sueles gastar ${formatEurosRedondo(ritmo)}, así que vas holgado.`)))
  return li
}

/**
 * @param {string} titulo
 * @param {number} importe
 * @param {number | null} queda
 * @param {boolean} [mal]
 */
function encabezado(titulo, importe, queda, mal = false) {
  const li = nodo('li', queda === null ? 'cascada-fila cascada-final' : 'cascada-fila')
  const cabeza = nodo('div', 'cascada-cabeza')
  cabeza.append(
    nodo('span', 'cascada-titulo', titulo),
    nodo('span', `cifras ${mal ? 'alarma' : ''}`.trim(), formatEuros(importe, { signo: queda !== null })),
  )
  li.append(cabeza)
  if (queda !== null) li.append(nodo('p', 'cascada-queda', `quedan ${formatEurosRedondo(queda)}`))
  return li
}

/** @param {import('../../analisis/cascada.js').Escalon[]} lista */
function desglose(lista) {
  const ul = nodo('ul', 'cascada-detalle')
  for (const e of lista) {
    const li = nodo('li', e.saltado ? 'saltado' : '')
    li.append(
      nodo('span', 'cascada-nombre', e.nombre),
      nodo('span', 'cascada-cuando', e.saltado
        ? 'este mes no'
        : e.detalle + (e.aplazable ? ' · te lo puedes saltar' : '')),
      nodo('span', 'cifras', formatEuros(e.importe)),
    )
    marcarPreguntable(li, e.reciboId, rotuloDe(e.reciboId, e.nombre, e.importe), e.categoria)
    // Un traspaso a tu propio bolsillo y la cuota de un préstamo salen por el
    // mismo sitio y son lo contrario: sólo el usuario sabe cuál es cuál.
    if (e.puedeSerInversion) li.append(marcaDeInversion(e))
    // El botón va en todas las líneas, no sólo en las que ya habías marcado
    // como saltables. Decir «este mes no aporto los 500 €» tenía que ser un
    // clic, y eran dos: primero abrir el diálogo del recibo para declararlo
    // saltable y después saltarlo. Saltar un mes no compromete a nada —el
    // siguiente vuelve solo—, así que no hace falta pedir permiso antes.
    // Las cuotas de lo aplazado no tienen recibo propio: no hay nada que
    // saltarse, el banco las cobra igual.
    if (e.reciboId) li.append(botonDeSaltar(e))
    ul.append(li)
  }
  return ul
}

/**
 * Saltarse un mes no es darse de baja: el que viene vuelve solo. Sin esto, la
 * única forma de decir "este mes no aporto" era mentirle a la app para siempre.
 * @param {import('../../analisis/cascada.js').Escalon} e
 */
function botonDeSaltar(e) {
  const boton = document.createElement('button')
  boton.type = 'button'
  boton.className = 'cascada-saltar'
  boton.dataset.saltar = e.reciboId
  boton.dataset.mes = (e.fecha ?? '').slice(0, 7)
  boton.dataset.puesto = e.saltado ? 'si' : 'no'
  boton.textContent = e.saltado ? 'Volver a contarlo' : 'Este mes no'
  return boton
}

/** @param {import('../../analisis/cascada.js').Escalon} e */
function marcaDeInversion(e) {
  const label = nodo('label', 'cascada-marca')
  const casilla = document.createElement('input')
  casilla.type = 'checkbox'
  casilla.checked = e.inversion
  casilla.dataset.inversion = e.reciboId
  // La fila entera abre la ficha del recibo; la casilla decide otra cosa.
  label.addEventListener('click', (ev) => ev.stopPropagation())
  label.append(casilla, nodo('span', '', e.inversion ? 'Es ahorro, no gasto' : 'Marcar como ahorro'))
  return label
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
    const div = nodo('div', 'grupo')
    div.append(nodo('p', 'rotulo rotulo-menor', titulo), nodo('p', 'aclaracion', explicacion))
    const ol = nodo('ol', 'eventos pulsables')
    for (const f of lista) {
      const cada = f.periodicidad === 'mensual' ? 'al mes' : `cada ${MESES_DE[f.periodicidad]} meses`
      const equivalente = f.periodicidad === 'mensual' ? '' : ` · ${formatEuros(f.mensualEquivalente)} al mes equivalente`
      const fila = linea({
        marca: diaYMes(f.proximaPrevista),
        nombre: f.nombre,
        detalle: `${cada}${equivalente}${f.aplazable ? ' · te lo puedes saltar' : ''}`,
        importe: formatEuros(f.importeEsperado),
        clase: f.estado === 'retrasado' ? 'apagado' : '',
      })
      marcarPreguntable(fila, f.reciboId, rotuloDe(f.reciboId, f.nombre, f.importeEsperado))
      ol.append(fila)
    }
    div.append(ol)
    return div
  }

  const grupos = [
    grupo('Cada mes, lo mismo', 'Se puede dar por sabido lo que vale.', c.mensuales),
    grupo('Cada mes, distinto', 'La cifra es la mediana: lo que suele costar, no lo que costó la última vez.', c.variables),
    grupo('Cada pocos meses', 'Trimestrales y semestrales.', c.periodicos),
    grupo('Una vez al año', 'Lo que hay que ver venir con meses de antelación.', c.anuales),
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

/** @param {Estado} estado */
function pintarSuscripciones(estado) {
  const lista = estado.costes.suscripciones
  requerir('bloque-suscripciones').hidden = lista.length === 0
  if (lista.length === 0) return

  requerir('suscripciones').replaceChildren(...lista.map((f) => linea({
    nombre: f.nombre,
    detalle: `próxima el ${diaYMes(f.proximaPrevista)}`,
    importe: `${formatEuros(f.mensualEquivalente)} / mes`,
  })))

  requerir('suscripciones-pie').textContent =
    `Entre todas, ${formatEuros(estado.costes.suscripcionesMes)} al mes. `
    + `Al año son ${formatEurosRedondo(estado.costes.suscripcionesAnio)}.`
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
