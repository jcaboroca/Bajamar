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
import { CATEGORIAS } from '../../entidades/semillas.js'
import { pedirDatos } from '../hoja.js'
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

/**
 * Qué categorías del día a día has abierto. Al revés que los recibos, éstas
 * empiezan plegadas: la cabecera ya dice lo que cuestan.
 * @type {Set<string>}
 */
const abiertas = new Set()

/** Por encima de esto, una categoría se lee mejor con el resto en una línea. */
const COMERCIOS_A_LA_VISTA = 12

/** Cada cuánto llega, dicho como se dice. */
const CADA_CUANTO = {
  mensual: 'al mes',
  bimestral: 'cada dos meses',
  trimestral: 'cada tres meses',
  semestral: 'cada seis meses',
  anual: 'una vez al año',
}

export function montarCategorias({ alCambiarTrato, alMarcarAnual, alApuntarRecibo, alClasificar }) {
  requerir('dia-a-dia').addEventListener('click', async (e) => {
    const fila = e.target instanceof Element ? e.target.closest('[data-comercio]') : null
    if (!(fila instanceof HTMLElement) || !fila.dataset.comercio) return
    const datos = await pedirDatos({
      titulo: fila.dataset.nombre ?? 'Este comercio',
      aceptar: 'Cambiarlo',
      campos: [
        { nombre: 'categoria', etiqueta: '¿En qué lo cuentas?', tipo: 'lista', valor: fila.dataset.categoria ?? 'otros', opciones: Object.entries(CATEGORIAS) },
      ],
    })
    if (datos === null || datos === 'borrar' || datos.categoria === fila.dataset.categoria) return
    await alClasificar(fila.dataset.comercio, String(datos.categoria))
  })
  for (const caja of ['fijos', 'apartados']) {
    preguntarAlPulsar(requerir(caja), () => ultimo, alCambiarTrato)
  }
  requerir('apuntar-recibo').addEventListener('click', async () => {
    const datos = await pedirDatos({
      titulo: 'Un recibo que no veo',
      aceptar: 'Apuntarlo',
      campos: [
        { nombre: 'nombre', etiqueta: '¿Qué es?', tipo: 'texto', valor: '' },
        { nombre: 'importe', etiqueta: '¿Cuánto cuesta?', tipo: 'numero', valor: '', pista: 'En euros.' },
        { nombre: 'proxima', etiqueta: '¿Cuándo es el próximo?', tipo: 'fecha', valor: '' },
        { nombre: 'cada', etiqueta: '¿Cada cuánto llega?', tipo: 'lista', valor: 'anual', opciones: Object.entries(CADA_CUANTO).map(([id, texto]) => [id, texto]) },
        { nombre: 'categoria', etiqueta: '¿De qué tipo?', tipo: 'lista', valor: 'suscripciones', opciones: Object.entries(CATEGORIAS) },
      ],
    })
    if (datos === null || datos === 'borrar') return
    const euros = Number(String(datos.importe).replace(',', '.'))
    if (!datos.nombre || !datos.proxima || !Number.isFinite(euros) || euros === 0) return
    await alApuntarRecibo({
      id: `mano:${Date.now()}`,
      nombre: String(datos.nombre).slice(0, 40),
      importe: -Math.abs(Math.round(euros * 100)),
      proxima: String(datos.proxima),
      cada: String(datos.cada),
      categoria: String(datos.categoria),
    })
  })
  requerir('preguntas').addEventListener('change', (e) => {
    const casilla = e.target
    if (!(casilla instanceof HTMLInputElement) || !casilla.dataset.anual) return
    alMarcarAnual(casilla.dataset.anual, casilla.checked)
  })
}

/** @param {Estado} estado */
export function pintarCategorias(estado) {
  ultimo = estado
  pintarDiaADia(estado)
  pintarFijos(estado)
  pintarPreguntas(estado)
  pintarApartados(estado)
}

/**
 * El goteo partido en categorías, y cada categoría en los comercios que la
 * llenan. Es el único sitio donde se ve de qué está hecho «Compras», y por
 * tanto el único donde se puede deshacer.
 * @param {Estado} estado
 */
function pintarDiaADia(estado) {
  const trozos = estado.reparto
  requerir('bloque-dia-a-dia').hidden = trozos.length === 0
  if (trozos.length === 0) return
  requerir('dia-a-dia-aclaracion').textContent = `Lo que no es recibo: ${formatEuros(estado.ritmo.porMes)} al mes, `
    + 'contado con la mediana de tus meses completos.'

  requerir('dia-a-dia').replaceChildren(...trozos.map((t) => {
    const div = nodo('details', 'grupo')
    div.open = abiertas.has(t.categoria)
    div.addEventListener('toggle', () => {
      if (div.open) abiertas.add(t.categoria)
      else abiertas.delete(t.categoria)
    })
    const cabeza = nodo('summary', 'grupo-cabecera')
    cabeza.append(
      nodo('span', 'rotulo rotulo-menor', t.nombre),
      nodo('span', 'cifras grupo-suma', `${formatEuros(t.alMes)} al mes`),
    )
    const ol = nodo('ol', 'eventos pulsables')
    const vistos = t.comercios.slice(0, COMERCIOS_A_LA_VISTA)
    for (const c of vistos) {
      const nombre = c.entidadId ? estado.nombres.get(c.entidadId) ?? c.entidadId : 'Sin reconocer'
      const fila = linea({
        nombre,
        detalle: c.cuantos === 1 ? 'una vez' : `${c.cuantos} veces`,
        importe: formatEuros(c.alMes),
        clase: c.entidadId ? '' : 'apagado',
      })
      // Sin comercio reconocido no hay a quién ponerle regla.
      if (c.entidadId) {
        fila.dataset.comercio = c.entidadId
        fila.dataset.nombre = nombre
        fila.dataset.categoria = t.categoria
      }
      ol.append(fila)
    }
    const resto = t.comercios.slice(COMERCIOS_A_LA_VISTA)
    if (resto.length > 0) {
      ol.append(linea({
        nombre: `Otros ${resto.length} comercios`,
        detalle: 'los tienes todos en Movimientos',
        importe: formatEuros(resto.reduce((s, c) => s + c.alMes, 0)),
        clase: 'apagado',
      }))
    }
    div.append(cabeza, ol)
    return div
  }))
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
    // Lo que te devuelven sale de tu cuenta el día que toca —y la previsión lo
    // cuenta—, pero no es lo que te cuesta vivir un mes.
    const suma = lista.reduce((t, f) => (f.devuelto ? t : t + f.mensualEquivalente), 0)
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
        detalle: f.devuelto
          ? `${cada} · te lo devuelve ${f.devuelto}`
          : `${cada}${equivalente}${f.aplazable ? ' · te lo puedes saltar' : ''}`,
        importe: formatEuros(f.importeEsperado),
        clase: f.estado === 'retrasado' || f.devuelto ? 'apagado' : '',
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
      : a.motivo === 'anulado'
        ? 'te lo devuelven el mismo día'
        : 'ya no lo pagas'
    const fila = linea({ nombre: a.nombre, detalle, importe: '', clase: 'apagado' })
    // Lo anulado no es una decisión suya, así que no hay nada que reabrir.
    if (a.motivo !== 'anulado') marcarPreguntable(fila, a.reciboId, rotuloDe(a.reciboId, a.nombre, a.importe))
    return fila
  }))
}
