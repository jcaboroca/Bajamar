// @ts-check
/**
 * Previsión: el mes de arriba abajo.
 *
 * La nómina entera y de ella van saliendo cosas, en el orden en que se deciden.
 * Cada escalón deja a la derecha lo que queda, que es la cifra que contesta «¿y
 * entonces cuánto me sobra?».
 *
 * Los tres escalones que llevan detalle —fijos, inversiones y día a día— se
 * abren y se cierran. Cerrados, la cascada se lee entera de un vistazo: seis
 * líneas y la respuesta. Abiertos, se ve de dónde sale cada cifra. Antes eran
 * cuarenta líneas siempre, y para llegar a «acabas con» había que bajar.
 *
 * Aquí ya no vive ni el horizonte a doce meses —que es del Resumen, porque es
 * la misma pregunta que la bajamar pero más lejos— ni las listas de lo que se
 * repite, que se fueron a Categorías.
 */

import { formatEuros, formatEurosRedondo } from '../../dominio/dinero.js'
import { diasEntre } from '../../dominio/tipos.js'
import { montarSimulador, pintarSimulador } from '../simulador.js'
import { diaYMes, nodo, nombreDeMes, requerir } from '../piezas.js'
import { marcarPreguntable, preguntarAlPulsar, rotuloDe } from '../trato.js'

/**
 * @typedef {ReturnType<typeof import('../../estado.js').construirEstado>} Estado
 */

/** @type {Estado | null} */
let ultimo = null

/**
 * Qué escalones están abiertos.
 *
 * La cascada se vuelve a construir entera en cada refresco, y cualquier
 * decisión —saltarse un recibo, mover una barra— dispara uno. Sin recordarlo,
 * abrir «Día a día», tocar una barra y verlo cerrarse en la cara sería el
 * comportamiento normal de la pantalla.
 */
const abiertos = new Set()

export function montarPrevision({ alCambiarTrato, alApagarCategoria, alMarcarInversion, alSaltarCobro, alAsignar, alRecuadrar }) {
  montarSimulador({ alApagarCategoria, alAsignar, alRecuadrar })
  preguntarAlPulsar(requerir('cascada'), () => ultimo, alCambiarTrato)

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
}

/** @param {Estado} estado */
export function pintarPrevision(estado) {
  ultimo = estado
  pintarCascada(estado)
  pintarSimulador(estado)
}

/** Abre el escalón donde se reparte, y lo pone a la vista. */
export function abrirReparto() {
  abiertos.add('diaadia')
  if (ultimo) pintarCascada(ultimo)
  const quieto = matchMedia('(prefers-reduced-motion: reduce)').matches
  requerir('reparto').scrollIntoView({ behavior: quieto ? 'auto' : 'smooth', block: 'start' })
}

/** @param {Estado} estado */
function pintarCascada(estado) {
  const c = estado.cascada
  const nombre = nombreDeMes(c.mes)
  requerir('cascada-rotulo').textContent = `Tu ${nombre.toLowerCase()}`
  requerir('cascada-entradilla').textContent = c.ingreso === 0
    ? 'Todavía no sé lo que cobras, así que esto es sólo lo que sale.'
    : `Cobras ${formatEuros(c.ingreso)} y con eso pagas del ${diaYMes(c.desde)} `
      + `al ${diaYMes(c.hasta)}.`

  // El mes en curso ya tiene día a día vivido, y eso no es una previsión: es
  // dinero que se fue. Se separa de lo que falta para que las dos cifras no se
  // lean como una sola promesa.
  const periodo = estado.detalleMensual.find((m) => m.id === c.mes)
  const enCurso = periodo !== undefined && periodo.estado === 'enCurso'
  const gastado = enCurso && periodo ? periodo.diaADiaGastado : c.diaADia
  const porVenir = c.diaADia - gastado

  let queda = c.apertura
  const filas = [encabezado('Vienes con', c.apertura, queda)]
  queda += c.ingreso
  filas.push(encabezado('Lo que cobras', c.ingreso, queda))

  /**
   * @param {string} clave
   * @param {string} titulo
   * @param {string} cuandoNoHay
   * @param {number} suma
   * @param {import('../../analisis/cascada.js').Escalon[]} lista
   * @param {HTMLElement} [extra]
   * @param {string} [clase]
   */
  const escalon = (clave, titulo, cuandoNoHay, suma, lista, extra, clase = '') => {
    queda += suma
    const li = nodo('li', `cascada-fila ${clase}`.trim())
    const caja = plegable(clave, titulo, suma)
    if (lista.length > 0) caja.append(desglose(lista))
    else if (!extra) caja.append(nodo('p', 'cascada-vacio', cuandoNoHay))
    if (extra) caja.append(extra)
    li.append(caja, nodo('p', 'cascada-queda', `quedan ${formatEurosRedondo(queda)}`))
    filas.push(li)
  }

  // Todo lo que seguro que sale, junto y por día: los fijos de siempre, las
  // cuotas de lo aplazado y los recibos gordos que sólo caen este mes. Verlos
  // en tres montones no ayuda a decidir nada; el total sí.
  const seguros = [...c.fijos, ...c.plazos, ...c.toca]
    .sort((a, b) => (a.fecha ?? '').localeCompare(b.fecha ?? ''))
  escalon(
    'fijos',
    `Gastos fijos de ${nombre.toLowerCase()}`,
    'Ninguno.',
    c.sumaFijos + c.sumaPlazos + c.sumaToca,
    seguros,
  )
  escalon('inversiones', 'Inversiones', 'Este mes no apartas nada.', c.sumaInversiones, c.inversiones)

  filas.push(loQueQuedaParaVivir(queda, c, estado, enCurso ? gastado : null))

  // Las barras van dentro del escalón y no en un bloque aparte: se reparte en
  // el mismo sitio donde se ve cuánto queda por repartir.
  const reparto = requerir('reparto')
  reparto.hidden = false
  if (enCurso) {
    queda += gastado
    const li = nodo('li', 'cascada-fila')
    const caja = plegable('gastado', 'Día a día, hasta hoy', gastado)
    const apuntes = periodo ? periodo.desglose.diaADia.filter((a) => !a.previsto) : []
    if (apuntes.length === 0) caja.append(nodo('p', 'cascada-vacio', 'Todavía nada.'))
    else caja.append(loGastado(apuntes, estado))
    li.append(caja, nodo('p', 'cascada-queda', `quedan ${formatEurosRedondo(queda)}`))
    filas.push(li)
    escalon('diaadia', 'Lo que te queda a tu ritmo', '', porVenir, [], reparto, 'previsto')
  } else {
    escalon('diaadia', 'Día a día', '', c.diaADia, [], reparto)
  }

  filas.push(encabezado('Acabas con', c.cierre, null, c.cierre < 0))
  requerir('cascada').replaceChildren(...filas)

  pintarSaldoDelMes(estado)
  requerir('cascada-pie').textContent = margen(c)
}

/**
 * La cabecera que abre y cierra, recordando si estaba abierta.
 * @param {string} clave
 * @param {string} titulo
 * @param {number} importe
 */
function plegable(clave, titulo, importe) {
  const caja = document.createElement('details')
  caja.className = 'cascada-desglose'
  caja.open = abiertos.has(clave)
  caja.addEventListener('toggle', () => {
    if (caja.open) abiertos.add(clave)
    else abiertos.delete(clave)
  })
  const cabeza = document.createElement('summary')
  cabeza.className = 'cascada-cabeza'
  cabeza.append(
    nodo('span', 'cascada-titulo', titulo),
    nodo('span', 'cifras', formatEuros(importe, { signo: true })),
  )
  caja.append(cabeza)
  return caja
}

/**
 * Los apuntes de verdad que han ido saliendo este mes. Sin esto, la cifra de lo
 * ya gastado no se podía comprobar: un cargo gordo del taller subía el total y
 * no había dónde ir a ver que era él.
 * @param {import('../../analisis/mensual.js').Apunte[]} apuntes
 * @param {Estado} estado
 */
function loGastado(apuntes, estado) {
  const ul = nodo('ul', 'cascada-detalle')
  for (const a of [...apuntes].sort((x, y) => y.fecha.localeCompare(x.fecha))) {
    const li = nodo('li')
    li.append(
      nodo('span', 'cascada-nombre', (a.entidadId && estado.nombres.get(a.entidadId)) || a.concepto),
      nodo('span', 'cascada-cuando', diaYMes(a.fecha)),
      nodo('span', 'cifras', formatEuros(a.importe)),
    )
    ul.append(li)
  }
  return ul
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
 * @param {Estado} estado
 * @param {number | null} gastado lo que ya se ha ido, si el mes está en curso
 */
function loQueQuedaParaVivir(queda, c, estado, gastado) {
  // Lo ya vivido tiene su gasto puesto más abajo: repartir el mes entero entre
  // todos sus días decía «vas holgado» el día 29 con el dinero ya gastado.
  const enCurso = gastado !== null
  const restante = enCurso ? queda - Math.abs(gastado) : queda
  const dias = enCurso
    ? Math.max(diasEntre(estado.hoy, c.hasta), 0) + 1
    : diasEntre(c.desde, c.hasta) + 1
  const alDia = Math.round(restante / dias)
  const ritmo = Math.round(Math.abs(estado.ritmo.porMes) / 30.4)
  const apurado = alDia < ritmo

  const li = nodo('li', `cascada-fila cascada-vivir${restante < 0 || apurado ? ' alarma' : ''}`)
  const cabeza = nodo('div', 'cascada-cabeza')
  cabeza.append(
    nodo('span', 'cascada-titulo', 'Te queda para el día a día'),
    nodo('span', 'cascada-importe cifras', formatEuros(queda)),
  )
  li.append(cabeza)

  if (restante <= 0) {
    li.append(nodo('p', 'cascada-vivir-lectura', 'No queda nada. Todo lo que gastes sale del colchón.'))
    return li
  }
  const plazo = enCurso
    ? (dias === 1 ? 'el día que falta' : `los ${dias} días que faltan`)
    : (dias === 1 ? 'un día' : `${dias} días`)
  // La cifra de arriba es la del mes entero; sin decir lo ya gastado, la
  // división no cuadra a ojo y parece un error.
  const llevas = enCurso ? `Te has gastado ${formatEurosRedondo(Math.abs(gastado))}. Con lo que queda, ` : ''
  li.append(nodo('p', 'cascada-vivir-lectura',
    `${llevas}${formatEurosRedondo(alDia)} al día durante ${plazo}. `
    + (apurado
      ? `Sueles gastar ${formatEurosRedondo(ritmo)}, así que toca apretar.`
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
    const li = nodo('li', e.saltado ? 'saltado' : e.previsto ? 'previsto' : '')
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
