// @ts-check
/**
 * Resumen: tres preguntas y nada más.
 *
 * Llegó a tener diez bloques, tres cifras grandes compitiendo por ser la
 * importante y la misma lista repetida en tres sitios. Una pantalla así no se
 * lee: se hojea.
 *
 * Ahora contesta, en este orden, lo único que se mira a diario:
 *
 *   1. ¿Llego? — el punto más bajo del periodo y cuándo.
 *   2. ¿Cuánto tengo para vivir, y a qué ritmo?
 *   3. ¿Voy bien, o me estoy pasando?
 *
 * Y habla siempre de un periodo concreto, elegido arriba. Un periodo va de una
 * nómina a la siguiente, así que septiembre es del 25 de agosto al 24 de
 * septiembre: el día 1 no empieza nada, llevas seis días viviendo del dinero
 * que entró.
 */

import { formatEuros, formatEurosRedondo } from '../../dominio/dinero.js'
import { diasEntre, fechaLarga } from '../../dominio/tipos.js'
import { residuoDe } from '../../analisis/mensual.js'
import { diasQueDura } from '../../analisis/periodos.js'
import { dibujarLamina } from '../lamina.js'
import { barra, cuentas, diaYMes, nodo, nombreDeMes, requerir, titular, vacio } from '../piezas.js'
import { marcarPreguntable, preguntarAlPulsar } from '../trato.js'

/**
 * @typedef {ReturnType<typeof import('../../estado.js').construirEstado>} Estado
 * @typedef {Estado['detalleMensual'][number]} Periodo
 */

/** @type {Estado | null} */
let ultimo = null

/** Cuál se está mirando. Vacío = el que esté en curso. */
let elegido = ''

export function montarResumen({ alCambiarTrato }) {
  preguntarAlPulsar(requerir('avisos'), () => ultimo, alCambiarTrato)
  requerir('mes-antes').addEventListener('click', () => mover(-1))
  requerir('mes-despues').addEventListener('click', () => mover(1))
}

/** @param {number} paso */
function mover(paso) {
  if (!ultimo) return
  const lista = ultimo.detalleMensual
  const i = lista.findIndex((p) => p.id === cual(ultimo).id)
  const destino = lista[i + paso]
  if (!destino) return
  elegido = destino.id
  pintarResumen(ultimo, { animar: false })
}

/**
 * El periodo que toca pintar: el elegido si sigue existiendo, y si no el que
 * está en curso. Que deje de existir pasa: al cargar un extracto nuevo los
 * cortes se recalculan y el que mirabas puede quedarse atrás.
 * @param {Estado} estado
 * @returns {Periodo}
 */
function cual(estado) {
  const lista = estado.detalleMensual
  return lista.find((p) => p.id === elegido)
    ?? lista.find((p) => p.estado === 'enCurso')
    ?? lista[lista.length - 1]
}

/**
 * @param {Estado} estado
 * @param {{ animar: boolean }} opciones
 */
export function pintarResumen(estado, { animar }) {
  ultimo = estado
  if (estado.detalleMensual.length === 0) return
  const periodo = cual(estado)

  pintarAvisos(estado)
  pintarNavegador(estado, periodo)
  pintarLlego(estado, periodo, animar)
  pintarVivir(estado, periodo)
  pintarComoVas(periodo)
}

/** Cómo se lee: «octubre», o «octubre de 2027» si cambia el año. */
function comoSeLlama(periodo, estado) {
  const nombre = nombreDeMes(periodo.id).toLowerCase()
  return periodo.id.slice(0, 4) === estado.hoy.slice(0, 4)
    ? nombre
    : `${nombre} de ${periodo.id.slice(0, 4)}`
}

/** @param {Estado} estado */
function pintarAvisos(estado) {
  // Sólo lo que de verdad hay que mirar hoy. Un resumen que siempre tiene un
  // aviso encima deja de tener avisos: tiene decoración.
  const graves = estado.avisos.filter((a) => a.nivel === 'alto')
  requerir('bloque-avisos').hidden = graves.length === 0
  requerir('avisos').replaceChildren(...graves.slice(0, 2).map((a) => {
    const li = nodo('li', `aviso aviso-${a.nivel}`)
    li.append(nodo('p', 'aviso-titulo', a.titulo), nodo('p', 'aviso-detalle', a.detalle))
    if (a.reciboId) marcarPreguntable(li, a.reciboId)
    return li
  }))
}

/**
 * @param {Estado} estado
 * @param {Periodo} periodo
 */
function pintarNavegador(estado, periodo) {
  const lista = estado.detalleMensual
  const i = lista.findIndex((p) => p.id === periodo.id)
  requerir('mes-elegido').textContent = `${nombreDeMes(periodo.id)} ${periodo.id.slice(0, 4)}`
  const antes = /** @type {HTMLButtonElement} */ (requerir('mes-antes'))
  const despues = /** @type {HTMLButtonElement} */ (requerir('mes-despues'))
  antes.disabled = i <= 0
  despues.disabled = i >= lista.length - 1

  // Que un periodo llamado septiembre empiece el 25 de agosto hay que decirlo,
  // o parece un error de la aplicación.
  const cuando = periodo.natural
    ? 'Del 1 al último, porque no he reconocido tu nómina.'
    : `Del ${fechaLarga(periodo.desde)} al ${fechaLarga(periodo.hasta)}, ${diasQueDura(periodo)} días.`
  const estadoTexto = periodo.estado === 'cerrado'
    ? 'Cerrado: esto es lo que pasó.'
    : periodo.estado === 'enCurso'
      ? 'En curso: lo vivido es real y lo que queda, previsión.'
      : 'Todo previsión, hasta que cargues el extracto que lo haga real.'
  requerir('mes-estado').textContent = `${cuando} ${estadoTexto}`
}

/**
 * 1 · ¿Llego? El punto más bajo y cuándo, con la curva debajo.
 * @param {Estado} estado
 * @param {Periodo} periodo
 * @param {boolean} animar
 */
function pintarLlego(estado, periodo, animar) {
  requerir('suelo-rotulo').textContent = `La bajamar de ${comoSeLlama(periodo, estado)}`

  /*
   * El saldo, dicho con todas las letras y antes que nada.
   *
   * La bajamar ya es un saldo —lo que habrá en la cuenta ese día, con el
   * ahorro acumulado dentro— pero leída sola, encima de un bloque que suma y
   * resta la nómina, parece flujo del mes. Faltaba el punto de partida: lo que
   * hay ahora mismo. Estaba, en letra pequeña dentro del gráfico.
   */
  requerir('suelo-saldo').textContent = periodo.estado === 'enCurso'
    ? `Hoy tienes ${formatEurosRedondo(estado.saldoInicial)}`
    : periodo.estado === 'futuro'
      ? `Entras con ${formatEurosRedondo(periodo.apertura)}`
      : `Empezaste con ${formatEurosRedondo(periodo.apertura)}`

  const cifra = requerir('suelo-cifra')
  cifra.replaceChildren(...titular(formatEurosRedondo(periodo.suelo.saldo)))
  cifra.parentElement?.classList.toggle('en-rojo', periodo.suelo.saldo < 0)

  // El periodo se mira entero, así que el punto más bajo puede haber pasado ya.
  const dias = diasEntre(estado.hoy, periodo.suelo.fecha)
  const cuando = dias === 0
    ? 'hoy mismo'
    : dias > 0
      ? `dentro de ${dias} ${dias === 1 ? 'día' : 'días'}`
      : `hace ${-dias} ${dias === -1 ? 'día' : 'días'}`
  const cierre = periodo.estado === 'cerrado'
    ? `Cerraste con ${formatEurosRedondo(periodo.saldoFinal)}.`
    : `Acabas con ${formatEurosRedondo(periodo.saldoFinal)}.`

  requerir('suelo-pie').replaceChildren(
    document.createTextNode('el '),
    nodo('strong', '', fechaLarga(periodo.suelo.fecha)),
    document.createTextNode(`, ${cuando}. ${cierre}`),
  )

  const margen = estado.margen
  const alivio = requerir('suelo-margen')
  alivio.hidden = margen === null || margen.gana < 5000 || periodo.estado !== 'enCurso'
  if (margen !== null && !alivio.hidden) {
    alivio.textContent = periodo.suelo.saldo < 0
      ? `Si te saltas lo que puedes saltarte, el suelo sube a ${formatEurosRedondo(margen.suelo.saldo)}.`
      : `Tienes ${formatEurosRedondo(margen.gana)} más de margen si te saltas lo que puedes saltarte.`
  }

  const lamina = requerir('lamina')
  if (periodo.curva.length < 2) {
    lamina.replaceChildren(vacio('No hay días que dibujar todavía.'))
    return
  }
  lamina.replaceChildren(dibujarLamina({
    curva: periodo.curva,
    suelo: periodo.suelo,
    desde: periodo.desde,
    hasta: periodo.hasta,
    saldoInicial: periodo.apertura,
  }, {
    rotuloInicio: periodo.estado === 'cerrado' ? 'empezaste con' : 'empiezas con',
    vivido: periodo.estado === 'cerrado',
  }))
  lamina.classList.remove('dibujando')
  if (animar) {
    void lamina.offsetWidth // reiniciar la animación sin esperar a un cuadro
    lamina.classList.add('dibujando')
  }
}

/**
 * 2 · ¿Cuánto tengo para vivir, y a qué ritmo?
 *
 * La cascada entera en cuatro líneas: lo que había, lo que entra, lo que sale
 * con fecha y lo que ya se ha ido en el día a día. Lo de abajo es la resta de
 * lo de arriba, que en un mes cerrado es con lo que se cerró. El ritmo al
 * lado, porque «1.841 €» no dice nada hasta que se convierte en «59 € al día».
 *
 * @param {Estado} estado
 * @param {Periodo} periodo
 */
function pintarVivir(estado, periodo) {
  requerir('vivir-rotulo').textContent = periodo.estado === 'cerrado'
    ? `Cómo fue ${comoSeLlama(periodo, estado)}`
    : `Cómo va ${comoSeLlama(periodo, estado)}`

  const queda = residuoDe(periodo)
  const gastado = Math.abs(periodo.diaADiaGastado)
  const restante = queda - gastado
  const caja = requerir('vivir')
  // La fórmula entera y a la vista, para que la resta se pueda seguir con el
  // dedo: saldo, más lo que entra, menos todo lo que sale con fecha, menos lo
  // que ya se ha ido en el día a día.
  caja.replaceChildren(
    cuentas([['Saldo al empezar', formatEuros(periodo.apertura)]]),
    desplegable('Nómina y otros ingresos', periodo.ingresos.total, periodo.desglose.entra, estado, true),
    desplegable('Recibos, cuotas y traspasos', periodo.compromisos, periodo.desglose.conFecha, estado, false),
    desplegable(
      periodo.estado === 'cerrado' ? 'Día a día' : 'Día a día, hasta hoy',
      periodo.diaADiaGastado, periodo.desglose.diaADia, estado, false,
    ),
  )

  const total = nodo('p', 'subtitular')
  total.append(...titular(formatEurosRedondo(restante)))
  if (restante < 0) total.classList.add('en-rojo')
  caja.append(total)

  const dias = diasQueDura(periodo)
  const habitual = Math.round(Math.abs(estado.ritmo.porMes) / 30.4)

  /*
   * Un periodo cerrado no se prevé, se cuenta. Decirle a alguien que «vas
   * holgado» de un mes que terminó hace seis días es hablarle de un dinero
   * que ya no existe: lo que quiere saber es en qué se le fue.
   */
  if (periodo.estado === 'cerrado') {
    const alDiaReal = Math.round(gastado / Math.max(dias, 1))
    requerir('vivir-nota').textContent = gastado === 0
      ? 'No gastaste nada en el día a día.'
      : `${formatEurosRedondo(alDiaReal)} al día durante ${dias} días, `
        + `y tu mes normal son ${formatEurosRedondo(habitual)}.`
    return
  }

  // La cifra de arriba es dinero que existe; ésta es una cuenta. Van separadas
  // y en ámbar para que no se confundan, y la de abajo crece sola según van
  // llegando los apuntes al extracto.
  const porVenir = periodo.diaADia - periodo.diaADiaGastado
  caja.append(cuentas([
    ['Lo que te queda por gastar, a tu ritmo', formatEuros(porVenir)],
    [`Acabarías el ${diaYMes(periodo.hasta)} con`, formatEuros(restante + porVenir)],
  ], 'previsto'))

  // El ritmo que queda es sobre los días que quedan: los ya vividos tienen su
  // gasto puesto arriba y contarlos otra vez infla lo que se puede gastar.
  const quedanDias = Math.max(diasEntre(estado.hoy, periodo.hasta), 0) + 1
  const alDia = Math.round(restante / quedanDias)
  const comparacion = habitual === 0
    ? ''
    : alDia < habitual
      ? ` Sueles gastar ${formatEurosRedondo(habitual)}, así que toca apretar.`
      : ` Sueles gastar ${formatEurosRedondo(habitual)}, así que vas holgado.`
  requerir('vivir-nota').textContent = restante <= 0
    ? 'No queda nada: todo lo que gastes sale de lo que tenías.'
    : `${formatEurosRedondo(alDia)} al día durante los ${quedanDias} días que quedan.${comparacion}`
}

/**
 * Una línea del bloque que se abre y enseña de dónde sale su cifra.
 *
 * Un total sin desglose obliga a creérselo. Con dos líneas de más —la fecha y
 * el concepto— deja de haber nada que creerse: se comprueba.
 *
 * @param {string} rotulo
 * @param {number} total
 * @param {import('../../analisis/mensual.js').Apunte[]} apuntes
 * @param {Estado} estado
 * @param {boolean} conSigno
 */
function desplegable(rotulo, total, apuntes, estado, conSigno) {
  const caja = document.createElement('details')
  caja.className = 'desglose'
  const cabeza = document.createElement('summary')
  cabeza.append(
    nodo('span', '', rotulo),
    nodo('span', 'cifras', formatEuros(total, conSigno ? { signo: true } : undefined)),
  )
  caja.append(cabeza)

  if (apuntes.length === 0) {
    caja.append(nodo('p', 'aclaracion vacio', 'Nada en este periodo.'))
    return caja
  }

  const ul = nodo('ul', 'desglose-lista')
  for (const a of apuntes) {
    const li = nodo('li', a.previsto ? 'previsto' : '')
    li.append(
      nodo('span', 'desglose-fecha', diaYMes(a.fecha)),
      nodo('span', 'desglose-nombre',
        (a.entidadId && estado.nombres.get(a.entidadId)) || a.concepto),
      nodo('span', 'cifras', formatEuros(a.importe, { signo: true })),
    )
    if (a.previsto) li.append(nodo('span', 'desglose-marca', 'previsto'))
    ul.append(li)
  }
  caja.append(ul)
  return caja
}

/**
 * 3 · ¿Voy bien? Sólo lo que se desvía.
 *
 * Una lista de doce categorías con sus barras no contesta «¿voy bien?»: hay
 * que leerla entera para saberlo. Lo que contesta es lo que se sale de lo
 * previsto, y si no se sale nada, decirlo en una línea.
 *
 * @param {Periodo} periodo
 */
function pintarComoVas(periodo) {
  requerir('reparto-rotulo').textContent = 'Cómo vas'
  const lista = requerir('categorias')

  if (!periodo.plan) {
    requerir('reparto-nota').textContent = ''
    lista.replaceChildren(vacio(
      'Todavía no has repartido este mes. En Previsión puedes decidir en qué se va, '
      + 'y entonces aquí te digo si te estás pasando.',
    ))
    return
  }

  // Se desvía si ya has gastado más de lo repartido, o si vas camino de ello.
  const desviadas = periodo.lineas
    .filter((l) => !l.propuesto && l.presupuesto > 0)
    .filter((l) => l.porcentaje >= 80)

  if (desviadas.length === 0) {
    requerir('reparto-nota').textContent = ''
    lista.replaceChildren(vacio('Vas en orden: ninguna categoría se te está yendo.'))
    return
  }

  requerir('reparto-nota').textContent = 'Sólo lo que se está saliendo de lo que repartiste.'
  const mayor = Math.max(...desviadas.map((l) => Math.max(l.presupuesto, l.gastado)), 1)
  lista.replaceChildren(...desviadas.map((l) => {
    const li = nodo('li', l.disponible < 0 ? 'en-rojo' : '')
    // El exceso va debajo del nombre: en una línea con la cifra no cabe en un
    // teléfono, y una cifra partida en dos renglones no se lee.
    const medio = nodo('span', 'evento-nombre')
    medio.append(nodo('span', '', l.nombre))
    if (l.disponible < 0) {
      medio.append(nodo('span', 'evento-detalle', `te has pasado ${formatEurosRedondo(-l.disponible)}`))
    }
    li.append(
      medio,
      nodo('span', 'evento-importe',
        `${formatEurosRedondo(-l.gastado)} de ${formatEurosRedondo(-l.presupuesto)}`),
      barra((l.gastado / mayor) * 100),
    )
    return li
  }))
}
