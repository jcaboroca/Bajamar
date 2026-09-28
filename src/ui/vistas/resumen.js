// @ts-check
/**
 * Resumen: un mes cada vez, y siempre dicho por su nombre.
 *
 * Antes esta pantalla decía «este mes» y la de Previsión también, pero no
 * hablaban del mismo: pasado el día 20 aquí era septiembre y allí octubre,
 * porque la nómina ya cobrada paga el mes que viene. Nadie puede leer dos
 * pantallas que usan la misma palabra para dos cosas.
 *
 * Así que se deja de decir «este mes». Arriba se elige el mes y todo lo de
 * abajo habla de él, del día 1 al último. El que está en curso va medio hecho
 * y medio previsto; los que vienen son previsión entera hasta que cargues el
 * extracto que los convierta en pasado.
 *
 * El orden no es decorativo. Primero lo que hay que saber —el punto bajo del
 * mes—, después de dónde sale, y al final lo que se ahorra, que es la
 * consecuencia y no el titular.
 */

import { formatEuros, formatEurosRedondo } from '../../dominio/dinero.js'
import { diasEntre, fechaLarga, mesDe } from '../../dominio/tipos.js'
import { mesContable } from '../../analisis/mes.js'
import { residuoDe } from '../../analisis/mensual.js'
import { dibujarLamina } from '../lamina.js'
import { barra, cuentas, diaYMes, linea, nodo, nombreDeMes, requerir, titular, vacio } from '../piezas.js'
import { marcarPreguntable, preguntarAlPulsar, rotuloDe } from '../trato.js'

/**
 * @typedef {ReturnType<typeof import('../../estado.js').construirEstado>} Estado
 * @typedef {Estado['detalleMensual'][number]} Mes
 */

/** @type {Estado | null} */
let ultimo = null

/** Cuál se está mirando. Vacío = el que esté en curso. */
let elegido = ''

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

  requerir('mes-antes').addEventListener('click', () => mover(-1))
  requerir('mes-despues').addEventListener('click', () => mover(1))
}

/** @param {number} paso */
function mover(paso) {
  if (!ultimo) return
  const meses = ultimo.detalleMensual
  const i = meses.findIndex((m) => m.mes === cual(ultimo).mes)
  const destino = meses[i + paso]
  if (!destino) return
  elegido = destino.mes
  pintarResumen(ultimo, { animar: false })
}

/**
 * El mes que toca pintar: el elegido si sigue existiendo, y si no el que está
 * en curso. Que deje de existir pasa de verdad: al cargar un extracto nuevo la
 * previsión se recalcula y el mes que mirabas puede quedarse atrás.
 * @param {Estado} estado
 * @returns {Mes}
 */
function cual(estado) {
  const meses = estado.detalleMensual
  return meses.find((m) => m.mes === elegido)
    ?? meses.find((m) => m.estado === 'enCurso')
    ?? meses[0]
}

/**
 * @param {Estado} estado
 * @param {{ animar: boolean }} opciones
 */
export function pintarResumen(estado, { animar }) {
  ultimo = estado
  if (estado.detalleMensual.length === 0) return
  const mes = cual(estado)

  pintarNavegador(estado, mes)
  pintarSuelo(estado, mes)
  pintarLamina(estado, mes, animar)
  pintarAvisos(estado)
  pintarDisponible(estado, mes)
  pintarMes(mes)
  pintarEventos(estado, mes)
  pintarPreguntas(estado)
  pintarCategorias(mes)
  pintarAhorro(mes)
}

/** Cómo se llama el mes en los rótulos: «octubre», o «octubre de 2027» si cambia el año. */
function comoSeLlama(mes, estado) {
  const nombre = nombreDeMes(mes.mes).toLowerCase()
  return mes.mes.slice(0, 4) === estado.hoy.slice(0, 4) ? nombre : `${nombre} de ${mes.mes.slice(0, 4)}`
}

/**
 * @param {Estado} estado
 * @param {Mes} mes
 */
function pintarNavegador(estado, mes) {
  const meses = estado.detalleMensual
  const i = meses.findIndex((m) => m.mes === mes.mes)
  requerir('mes-elegido').textContent =
    `${nombreDeMes(mes.mes)} ${mes.mes.slice(0, 4)}`

  const antes = /** @type {HTMLButtonElement} */ (requerir('mes-antes'))
  const despues = /** @type {HTMLButtonElement} */ (requerir('mes-despues'))
  antes.disabled = i <= 0
  despues.disabled = i >= meses.length - 1

  requerir('mes-estado').textContent = mes.acabado
    ? 'Mes cerrado. Esto es lo que ha pasado.'
    : mes.estado === 'enCurso'
      ? 'En curso: lo que ya ha pasado es real y lo que queda es previsión.'
      : 'Todo esto es previsión, hasta que cargues el extracto que lo haga real.'
}

/**
 * @param {Estado} estado
 * @param {Mes} mes
 */
function pintarSuelo(estado, mes) {
  requerir('suelo-rotulo').textContent = `La bajamar de ${comoSeLlama(mes, estado)}`

  const cifra = requerir('suelo-cifra')
  cifra.replaceChildren(...titular(formatEurosRedondo(mes.suelo.saldo)))
  cifra.parentElement?.classList.toggle('en-rojo', mes.suelo.saldo < 0)

  // Ahora el mes se mira entero, así que el punto más bajo puede haber pasado
  // ya. Decir «dentro de -4 días» sería peor que no decir nada.
  const dias = diasEntre(estado.hoy, mes.suelo.fecha)
  const cuando = dias === 0
    ? 'hoy mismo'
    : dias > 0
      ? `dentro de ${dias} ${dias === 1 ? 'día' : 'días'}`
      : `hace ${-dias} ${dias === -1 ? 'día' : 'días'}`

  const ultimo = mes.curva[mes.curva.length - 1]
  const cierre = mes.acabado
    ? `Cerraste con ${formatEurosRedondo(ultimo.saldo)}.`
    : `Cierras el mes con ${formatEurosRedondo(ultimo.saldo)}.`

  const pie = requerir('suelo-pie')
  pie.replaceChildren(
    document.createTextNode('el '),
    nodo('strong', '', fechaLarga(mes.suelo.fecha)),
    document.createTextNode(`, ${cuando}. ${cierre}`),
  )

  // El margen sólo es noticia si de verdad mueve el suelo, y sólo del mes en
  // curso: para uno que no ha empezado, saltarse un recibo es una decisión que
  // todavía no toca tomar.
  const margen = estado.margen
  const alivio = requerir('suelo-margen')
  alivio.hidden = margen === null || margen.gana < 5000 || mes.estado !== 'enCurso'
  if (margen !== null && !alivio.hidden) {
    alivio.textContent = mes.suelo.saldo < 0
      ? `Si te saltas lo que puedes saltarte, el suelo sube a ${formatEurosRedondo(margen.suelo.saldo)}.`
      : `Tienes ${formatEurosRedondo(margen.gana)} más de margen si te saltas lo que puedes saltarte.`
  }
}

/**
 * La lámina, recortada al mes. Es la misma curva de siempre, sólo que se
 * enseña el tramo del que se está hablando.
 * @param {Estado} estado
 * @param {Mes} mes
 * @param {boolean} animar
 */
function pintarLamina(estado, mes, animar) {
  const curva = mes.curva
  const lamina = requerir('lamina')
  if (curva.length < 2) {
    lamina.replaceChildren(vacio('No hay días que dibujar en este mes.'))
    return
  }

  // Si las dos lecturas se separan es porque en el mes entró dinero que paga
  // el siguiente. Merece decirse, porque es la única forma de entender que el
  // punto más bajo esté por debajo de la línea de arriba.
  const seSepara = curva.some((p) => p.propio !== p.saldo)
  requerir('lamina-rotulo').textContent = seSepara
    ? `Cómo va ${comoSeLlama(mes, estado)} · la línea de puntos no cuenta lo que paga el mes siguiente`
    : `Cómo va ${comoSeLlama(mes, estado)}`

  lamina.replaceChildren(dibujarLamina({
    curva,
    suelo: mes.suelo,
    desde: curva[0].fecha,
    hasta: curva[curva.length - 1].fecha,
    saldoInicial: curva[0].saldo,
  }, { rotuloInicio: 'día 1' }))

  lamina.classList.remove('dibujando')
  if (animar) {
    void lamina.offsetWidth // reiniciar la animación sin esperar a un cuadro
    lamina.classList.add('dibujando')
  }
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

/**
 * @param {Estado} estado
 * @param {Mes} mes
 */
function pintarDisponible(estado, mes) {
  const caja = requerir('disponible')
  caja.replaceChildren()
  const enCurso = mes.estado === 'enCurso'

  if (enCurso) {
    const d = estado.disponible
    requerir('disponible-rotulo').textContent = `Cuánto puedes gastar hasta fin de ${comoSeLlama(mes, estado)}`
    requerir('disponible-nota').textContent =
      'El saldo del banco ya incluye todo lo que ha pasado. A eso se le suma sólo lo que falta.'
    caja.append(cuentas([
      ['Saldo de hoy', formatEuros(d.saldo)],
      ...(d.porCobrar !== 0 ? /** @type {Array<[string, string]>} */ ([['Lo que entra', formatEuros(d.porCobrar, { signo: true })]]) : []),
      ...(d.porPagar !== 0 ? /** @type {Array<[string, string]>} */ ([['Recibos pendientes', formatEuros(d.porPagar)]]) : []),
      ...(d.goteo !== 0 ? /** @type {Array<[string, string]>} */ ([['Gasto del día a día', formatEuros(d.goteo)]]) : []),
    ]))
    rematar(caja, d.total, 'es lo que te queda libre hasta fin de mes')
    return
  }

  // Un mes que no ha empezado se cuenta entero: con lo que entras, más lo que
  // cobras, menos lo que ya está comprometido.
  requerir('disponible-rotulo').textContent = `Cuánto podrás gastar en ${comoSeLlama(mes, estado)}`
  requerir('disponible-nota').textContent =
    'Del día 1 al último. Entras con lo que te deje el mes anterior.'
  caja.append(cuentas([
    ['Entras con', formatEuros(mes.apertura)],
    ['Lo que cobras', formatEuros(mes.ingresos.total, { signo: true })],
    ['Recibos y cuotas', formatEuros(mes.compromisos)],
  ]))
  rematar(caja, residuoDe(mes), 'queda para el día a día de todo el mes')
}

/**
 * @param {HTMLElement} caja
 * @param {number} cifra
 * @param {string} pie
 */
function rematar(caja, cifra, pie) {
  const total = nodo('p', 'subtitular')
  total.append(...titular(formatEurosRedondo(cifra)))
  if (cifra < 0) total.classList.add('en-rojo')
  caja.append(total, nodo('p', 'pie pie-menor', pie))
}

/** @param {Mes} mes */
function pintarMes(mes) {
  requerir('mes-resumen-rotulo').textContent = mes.acabado ? 'Cómo ha ido' : 'Cómo va'
  const caja = requerir('mes-resumen')

  /**
   * @param {string} titulo
   * @param {import('../../analisis/mensual.js').Reparto} reparto
   */
  const tramo = (titulo, reparto) => {
    const div = nodo('div', 'tramo')
    div.append(
      nodo('p', 'tramo-rotulo', titulo),
      nodo('p', 'tramo-cifra cifras', formatEuros(reparto.total)),
      nodo('p', 'tramo-detalle', detalleDe(reparto, mes)),
    )
    return div
  }

  caja.replaceChildren(tramo('Ingresos', mes.ingresos), tramo('Gastos', mes.gastos))
}

/**
 * @param {import('../../analisis/mensual.js').Reparto} reparto
 * @param {Mes} mes
 */
function detalleDe(reparto, mes) {
  // Nunca «todo previsión» por el hecho de que el mes no haya empezado: a
  // octubre lo paga una nómina que ya está en el banco, y llamarla previsión
  // es decir que no ha pasado algo que sí ha pasado.
  if (reparto.total === 0) return 'nada'
  if (reparto.real === 0) return 'todo previsión'
  if (reparto.previsto === 0) return 'ya está todo'
  return `${formatEuros(reparto.real)} ya · ${formatEuros(reparto.previsto)} previsto`
}

/**
 * @param {Estado} estado
 * @param {Mes} mes
 */
function pintarEventos(estado, mes) {
  // Ni «lo que viene» ni «lo que queda por pasar»: en esta lista hay cobros
  // que ya han entrado, porque son los que pagan el mes. El rótulo tiene que
  // caber en las dos cosas.
  requerir('eventos-rotulo').textContent = `El dinero de ${comoSeLlama(mes, estado)}`

  /*
   * Lo que paga este mes, no lo que cae dentro de sus días. Son cosas
   * distintas: la nómina del 25 de octubre paga noviembre, y si saliera en la
   * lista de octubre habría un total de 2.800 y una línea de 2.800 que son
   * dinero diferente. Se suman y no cuadra.
   *
   * Por eso los eventos se filtran igual que se suman, y por eso delante van
   * los cobros que ya han entrado: en un mes que aún no ha empezado, esos son
   * justamente de dónde sale su dinero.
   */
  const previstos = estado.proyeccionLarga.eventos.filter((e) => mesContable(e) === mes.mes)
  const lista = requerir('eventos')
  if (previstos.length === 0 && mes.cobrado.length === 0) {
    lista.replaceChildren(vacio('No hay nada previsto en este mes.'))
    return
  }

  const yaEstan = mes.cobrado.map((m) => linea({
    marca: diaYMes(m.fecha),
    nombre: m.nombre ?? m.conceptoRaw,
    detalle: 'ya cobrada · paga este mes',
    importe: formatEuros(m.importe, { signo: true }),
    clase: 'confirmado',
  }))

  lista.replaceChildren(...yaEstan, ...previstos.map((e) => {
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

/**
 * Lo repartido contra lo gastado, categoría a categoría.
 *
 * Es la misma lista que antes enseñaba una media de doce meses, pero esa
 * contestaba a «en qué se te va la vida» y aquí la pregunta es otra: en qué se
 * está yendo este mes, y si se parece a lo que dijiste que ibas a gastar.
 *
 * @param {Mes} mes
 */
function pintarCategorias(mes) {
  const lineas = mes.lineas.filter((l) => l.presupuesto > 0 || l.gastado > 0)
  const lista = requerir('categorias')
  requerir('categorias-rotulo').textContent = 'En qué se va'

  // Sólo lo repartido lleva objetivo. El resto —el alquiler, la luz— sale en
  // la lista porque es gasto del mes, pero no se reparte con una barra: para
  // dejar de pagar un recibo no se mueve un deslizador. Enseñar «-750 € de
  // -750 €» en algo que nunca presupuestaste es inventarse un objetivo.
  const repartidas = lineas.filter((l) => !l.propuesto).length
  requerir('categorias-nota').textContent = repartidas === 0
    ? 'Todavía no has repartido este mes. En Previsión puedes decidir en qué se va.'
    : 'Las que has repartido llevan al lado lo que decidiste gastar.'

  if (lineas.length === 0) {
    lista.replaceChildren(vacio('Aún no hay gasto ni reparto en este mes.'))
    return
  }

  const mayor = Math.max(...lineas.map((l) => Math.max(l.presupuesto, l.gastado)), 1)
  lista.replaceChildren(...lineas.map((l) => {
    const conPlan = !l.propuesto
    const li = nodo('li', conPlan && l.disponible < 0 ? 'en-rojo' : '')
    li.append(
      nodo('span', '', l.nombre),
      nodo('span', 'evento-importe', conPlan
        ? `${formatEurosRedondo(-l.gastado)} de ${formatEurosRedondo(-l.presupuesto)}`
        : formatEurosRedondo(-(l.gastado || l.presupuesto))),
      barra((Math.max(l.gastado, l.presupuesto) / mayor) * 100),
    )
    return li
  }))
}

/**
 * Lo que se ahorra: lo que entra menos lo que sale, y en el tiempo verbal que
 * toca. Mientras el mes corre es una previsión que se va corrigiendo sola con
 * cada extracto; el día que se cierra deja de ser una promesa y pasa a ser un
 * hecho, y merece decirse así.
 * @param {Mes} mes
 */
function pintarAhorro(mes) {
  requerir('ahorro-rotulo').textContent = mes.acabado
    ? 'Lo que has ahorrado'
    : mes.estado === 'enCurso' ? 'Lo que vas a ahorrar' : 'Lo que ahorrarías'

  const caja = requerir('capacidad')
  caja.replaceChildren(cuentas([
    ['Lo que entra', formatEuros(mes.ingresos.total, { signo: true })],
    ['Lo que sale', formatEuros(mes.gastos.total)],
  ]))

  rematar(caja, mes.ahorro, mes.acabado
    ? 'este mes lo has cerrado así'
    : mes.estado === 'enCurso'
      ? 'si el resto del mes va como está previsto'
      : 'si se cumple la previsión')
}
