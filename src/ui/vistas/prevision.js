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
import { mesDe, ultimoDiaDelMes, sumarMeses } from '../../dominio/tipos.js'
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
/** @type {string | null} */
let mesElegido = null

/** @type {Estado | null} */
let ultimo = null

export function montarPrevision({ alCambiarTrato, alApagarCategoria, alMarcarInversion, alSaltarCobro }) {
  montarSimulador({ alApagarCategoria })
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

  requerir('meses-tabla').addEventListener('click', (e) => {
    const li = e.target instanceof Element ? e.target.closest('li[data-mes]') : null
    if (!(li instanceof HTMLElement)) return
    mesElegido = li.dataset.mes ?? null
    repintar()
    requerir('calendario-rotulo').scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

/** @param {Estado} estado */
export function pintarPrevision(estado) {
  ultimo = estado
  mesElegido = null
  repintar()
}

function repintar() {
  if (!ultimo) return
  const estado = ultimo
  const hasta = ultimoDiaDelMes(sumarMeses(estado.hoy, horizonte - 1))
  const proyeccion = recortar(estado.proyeccionLarga, hasta)
  const meses = estado.meses.filter((f) => f.mes <= mesDe(hasta))

  requerir('lamina-larga').replaceChildren(dibujarLamina(proyeccion, { marca: 'largo' }))

  requerir('prevision-pie').textContent =
    `El suelo de estos ${horizonte} meses es ${formatEurosRedondo(proyeccion.suelo.saldo)}. `
    + 'De aquí en adelante sólo hay recibos que se repiten y tu ritmo de gasto medido: '
    + 'cuanto más lejos, menos seguro.'

  pintarMeses(meses, estado)
  pintarCalendario(estado, meses)
  pintarCascada(estado)
  pintarSimulador(estado)
  pintarFijos(estado)
  pintarApartados(estado)
  pintarSuscripciones(estado)
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
 * @param {import('../../analisis/mes.js').FilaMes[]} meses
 * @param {Estado} estado
 */
function pintarMeses(meses, estado) {
  const lista = requerir('meses-tabla')
  const actual = mesElegido ?? mesDe(estado.hoy)

  lista.replaceChildren(...meses.map((f) => {
    const li = nodo('li', `mes${f.mes === actual ? ' elegido' : ''}${f.ahorro < 0 ? ' apretado' : ''}`)
    li.dataset.mes = f.mes
    li.tabIndex = 0
    li.setAttribute('role', 'button')

    const cabecera = nodo('div', 'mes-cabecera')
    cabecera.append(
      nodo('span', 'mes-nombre', nombreDeMes(f.mes)),
      nodo('span', `mes-ahorro cifras${f.ahorro < 0 ? ' en-rojo' : ''}`, formatEuros(f.ahorro, { signo: true })),
    )

    const detalle = nodo('div', 'mes-detalle')
    detalle.append(
      nodo('span', '', `entra ${formatEurosRedondo(f.ingresos)}`),
      nodo('span', '', `sale ${formatEurosRedondo(Math.abs(f.gastos))}`),
      nodo('span', f.suelo.saldo < 0 ? 'en-rojo' : '', `suelo ${formatEurosRedondo(f.suelo.saldo)}`),
    )

    li.append(cabecera, detalle)
    if (f.ahorro < 0) {
      li.append(nodo('p', 'mes-aviso', `En ${nombreDeMes(f.mes).toLowerCase()} se va más de lo que entra.`))
    }
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        li.click()
      }
    })
    return li
  }))
}

/**
 * Día a día del mes elegido, con el saldo que queda después de cada apunte.
 * @param {Estado} estado
 * @param {import('../../analisis/mes.js').FilaMes[]} meses
 */
function pintarCalendario(estado, meses) {
  const mes = mesElegido ?? meses[0]?.mes ?? mesDe(estado.hoy)
  requerir('calendario-rotulo').textContent = `Día a día · ${nombreDeMes(mes)}`

  const saldos = new Map(estado.proyeccionLarga.curva.map((p) => [p.fecha, p.saldo]))
  const eventos = estado.proyeccionLarga.eventos.filter((e) => mesDe(e.fecha) === mes)
  const lista = requerir('calendario')

  if (eventos.length === 0) {
    lista.replaceChildren(vacio('Ningún recibo ni ingreso previsto en este mes. Sólo el gasto del día a día.'))
    return
  }

  /** @type {Node[]} */
  const filas = []
  let anterior = ''
  for (const e of eventos) {
    const saldo = saldos.get(e.fecha)
    const li = linea({
      marca: e.fecha === anterior ? '' : diaYMes(e.fecha),
      nombre: e.nombre,
      detalle: saldo === undefined ? undefined : `quedan ${formatEurosRedondo(saldo)}`,
      importe: formatEuros(e.importe, { signo: true }),
      clase: `${e.seguro ? 'confirmado' : 'previsto'}${saldo !== undefined && saldo < 0 ? ' urgente' : ''}`,
    })
    anterior = e.fecha
    filas.push(li)
  }
  lista.replaceChildren(...filas)
}

/**
 * El mes de arriba abajo: la nómina entera y de ella van saliendo cosas, en el
 * orden en que se deciden. Cada escalón deja a la derecha lo que queda, que es
 * la cifra que contesta «¿y entonces cuánto me sobra?».
 * @param {Estado} estado
 */
function pintarCascada(estado) {
  const c = estado.cascada
  const anio = c.mes.slice(0, 4)
  const nombre = nombreDeMes(c.mes)
  requerir('cascada-rotulo').textContent = `Tu ${nombre.toLowerCase()}`
  requerir('cascada-entradilla').textContent = c.ingreso === 0
    ? 'Todavía no sé lo que cobras, así que esto es sólo lo que sale.'
    : `Cobras ${formatEuros(c.ingreso)} y con eso pagas del 1 al ${ultimoDiaDelMes(`${c.mes}-01`).slice(8)} `
      + `de ${nombre.toLowerCase()} de ${anio}.`

  let queda = c.ingreso
  const filas = [encabezado('Lo que cobras', c.ingreso, queda)]

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
  dia.append(desgloseDiaADia(estado, c.diaADia))
  filas.push(dia)

  filas.push(encabezado(c.resultado < 0 ? 'Te falta' : 'Te sobra', Math.abs(c.resultado), null, c.resultado < 0))
  requerir('cascada').replaceChildren(...filas)

  pintarSaldoDelMes(estado)
  requerir('cascada-pie').textContent = margen(c)
}

/**
 * La cascada es sólo el mes. Que falten 211 € no significa nada sin saber con
 * cuánto llegas, y ahí es donde vive el punto más bajo.
 * @param {Estado} estado
 */
function pintarSaldoDelMes(estado) {
  const caja = requerir('cascada-saldo')
  const fila = estado.meses.find((m) => m.mes === estado.cascada.mes)
  if (!fila) { caja.replaceChildren(); return }

  // El mes anterior cierra donde éste abre. Si el mes ya ha empezado no hay
  // cierre que mirar, y lo único cierto es lo que hay en el banco ahora.
  const anterior = estado.meses.find((m) => m.mes === sumarMeses(`${fila.mes}-01`, -1).slice(0, 7))
  const partes = [
    nodo('p', 'cascada-saldo-linea', anterior
      ? `Llegas con ${formatEurosRedondo(anterior.saldoFinal)} y lo acabarías con ${formatEurosRedondo(fila.saldoFinal)}.`
      : `Ahora tienes ${formatEurosRedondo(estado.saldoInicial)} y acabarías el mes con ${formatEurosRedondo(fila.saldoFinal)}.`),
  ]
  const bajo = nodo('p', `cascada-saldo-linea${fila.suelo.saldo < 0 ? ' alarma' : ''}`)
  bajo.textContent = `Tu punto más bajo: ${formatEurosRedondo(fila.suelo.saldo)} el ${diaYMes(fila.suelo.fecha)}.`
  partes.push(bajo)
  caja.replaceChildren(...partes)
}

/**
 * @param {import('../../analisis/cascada.js').Cascada} c
 */
function margen(c) {
  const base = 'Toca cualquier línea para decirme qué es y si te la puedes saltar.'
  if (c.aplazable === 0) {
    return c.resultado < 0
      ? `Con lo que cobras no llegas: la diferencia sale del saldo que ya tienes. ${base}`
      : `Las inversiones salen de la cuenta pero no se gastan: siguen siendo tuyas. ${base}`
  }
  const conMargen = c.resultado - c.aplazable
  return c.resultado < 0
    ? `Si este mes no traspasas lo que puedes saltarte, en vez de faltarte `
      + `${formatEuros(Math.abs(c.resultado))} te ${conMargen < 0 ? 'faltan' : 'sobran'} `
      + `${formatEuros(Math.abs(conMargen))}. ${base}`
    : `Saltarte lo que puedes saltarte te dejaría ${formatEuros(conMargen)} en vez de `
      + `${formatEuros(c.resultado)}. ${base}`
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
  const dias = Number(ultimoDiaDelMes(`${c.mes}-01`).slice(8))
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
    if (e.aplazable || e.saltado) li.append(botonDeSaltar(e))
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
  boton.addEventListener('click', (ev) => ev.stopPropagation())
  return boton
}

/**
 * De dónde sale el goteo. El total es la mediana de los meses completos, así
 * que las partes van en esa proporción: si las líneas no sumaran la cifra de
 * arriba, el desglose no explicaría nada.
 * @param {Estado} estado
 * @param {number} total
 */
function desgloseDiaADia(estado, total) {
  const reparto = estado.reparto.filter((r) => r.alMes < 0)
  const caja = nodo('div', 'cascada-detalle')
  if (reparto.length === 0) {
    caja.append(nodo('p', 'cascada-vacio', 'Compra, gasolina, restaurantes… al ritmo al que vienes gastando.'))
    return caja
  }
  const suma = reparto.reduce((t, r) => t + r.alMes, 0)
  const visibles = reparto.slice(0, 6)
  const ul = nodo('ul')
  let mostrado = 0
  for (const r of visibles) {
    const parte = Math.round(total * (r.alMes / suma))
    mostrado += parte
    const li = nodo('li')
    li.append(
      nodo('span', 'cascada-nombre', r.nombre),
      nodo('span', 'cascada-cuando', `${r.cuantos} apuntes`),
      nodo('span', 'cifras', formatEuros(parte)),
    )
    ul.append(li)
  }
  if (reparto.length > visibles.length) {
    const li = nodo('li')
    li.append(
      nodo('span', 'cascada-nombre', `Otras ${reparto.length - visibles.length} categorías`),
      nodo('span', 'cascada-cuando', ''),
      nodo('span', 'cifras', formatEuros(total - mostrado)),
    )
    ul.append(li)
  }
  caja.append(ul, nodo('p', 'cascada-vacio',
    `Es la mediana de tus últimos ${estado.ritmo.meses} meses: en la mitad gastaste más y en la otra mitad, menos.`))
  return caja
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
