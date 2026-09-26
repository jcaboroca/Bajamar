// @ts-check
/**
 * Patrimonio: lo que tienes, lo que debes y lo que persigues.
 *
 * Es la única pantalla que no sale sola de los extractos, porque un banco no
 * sabe lo que vale tu furgoneta. Lo que se anota aquí es una afirmación
 * fechada del usuario, y la aplicación no la revaloriza ni la extrapola: entre
 * dos anotaciones dibuja una recta porque no sabe otra cosa.
 */

import { formatEuros, formatEurosRedondo } from '../../dominio/dinero.js'
import { fechaLarga, hoyIso } from '../../dominio/tipos.js'
import { GRUPOS, ORDEN_GRUPOS, variacion } from '../../analisis/patrimonio.js'
import { progresoDe } from '../../analisis/objetivos.js'
import { barra, linea, nodo, requerir, titular, vacio } from '../piezas.js'
import { pedirDatos } from '../hoja.js'

/**
 * @typedef {ReturnType<typeof import('../../estado.js').construirEstado>} Estado
 * @typedef {import('../../analisis/patrimonio.js').Apunte} Apunte
 * @typedef {import('../../analisis/objetivos.js').Objetivo} Objetivo
 */

/** @type {Estado | null} */
let ultimo = null
/** @type {Objetivo[]} */
let objetivos = []

/**
 * @type {{
 *   alGuardarApunte: (a: Apunte) => Promise<void>,
 *   alBorrarApunte: (id: string) => Promise<void>,
 *   alGuardarObjetivo: (o: Objetivo) => Promise<void>,
 *   alBorrarObjetivo: (id: string) => Promise<void>,
 *   nuevoId: () => string,
 * }}
 */
let ganchos

/** @param {typeof ganchos} enganches */
export function montarPatrimonio(enganches) {
  ganchos = enganches

  requerir('apunte-nuevo').addEventListener('click', () => editarApunte(null))
  requerir('objetivo-nuevo').addEventListener('click', () => editarObjetivo(null))

  requerir('patrimonio-grupos').addEventListener('click', (e) => {
    const fila = e.target instanceof Element ? e.target.closest('li[data-apunte]') : null
    if (!(fila instanceof HTMLElement) || !ultimo) return
    const id = fila.dataset.apunte
    // La cuenta corriente sale del extracto: tocarla a mano sería mentirse.
    if (!id || id.startsWith('auto:')) return
    const apunte = ultimo.patrimonio.porGrupo.flatMap((g) => g.partidas).find((p) => p.id === id)
    if (apunte) editarApunte(apunte)
  })

  requerir('objetivos').addEventListener('click', (e) => {
    const fila = e.target instanceof Element ? e.target.closest('li[data-objetivo]') : null
    if (!(fila instanceof HTMLElement)) return
    const objetivo = objetivos.find((o) => o.id === fila.dataset.objetivo)
    if (objetivo) editarObjetivo(objetivo)
  })
}

/**
 * @param {Estado} estado
 * @param {Objetivo[]} metas
 */
export function pintarPatrimonio(estado, metas) {
  ultimo = estado
  objetivos = metas

  const b = estado.patrimonio
  const cifra = requerir('neto-cifra')
  cifra.replaceChildren(...titular(formatEurosRedondo(b.neto)))
  cifra.parentElement?.classList.toggle('en-rojo', b.neto < 0)

  const cambio = variacion(estado.evolucionPatrimonio, 12)
  requerir('neto-pie').textContent = cambio
    ? `${cambio.absoluta >= 0 ? '+' : ''}${formatEurosRedondo(cambio.absoluta)} `
      + `(${cambio.absoluta >= 0 ? '+' : ''}${Math.round(cambio.relativa * 100)}%) desde el ${fechaLarga(cambio.desde)}.`
    : 'Anota lo que tienes y lo que debes, y a partir de la segunda vez podré enseñarte cómo evoluciona.'

  pintarGrupos(estado)
  pintarObjetivos(estado)
}

/** @param {Estado} estado */
function pintarGrupos(estado) {
  const caja = requerir('patrimonio-grupos')
  const b = estado.patrimonio

  if (b.porGrupo.length === 0) {
    caja.replaceChildren(vacio('Todavía no hay nada anotado.'))
    return
  }

  caja.replaceChildren(...b.porGrupo.map((g) => {
    const div = nodo('div', 'grupo')
    const cabecera = nodo('div', 'grupo-cabecera')
    cabecera.append(
      nodo('span', 'rotulo rotulo-menor', g.nombre),
      nodo('span', 'cifras', formatEuros(g.total)),
    )
    div.append(cabecera)

    const ol = nodo('ol', 'eventos pulsables')
    for (const p of g.partidas) {
      const li = linea({
        nombre: p.nombre,
        detalle: p.id.startsWith('auto:') ? 'de tus extractos' : `anotado el ${fechaLarga(p.fecha)}`,
        importe: formatEuros(p.valor),
        clase: p.id.startsWith('auto:') ? 'apagado' : '',
      })
      li.dataset.apunte = p.id
      ol.append(li)
    }
    div.append(ol)
    return div
  }))

  const resumen = nodo('div', 'grupo')
  resumen.append(nodo('p', 'rotulo rotulo-menor', 'Total'))
  const dl = nodo('dl', 'datos')
  dl.append(
    nodo('dt', '', 'Lo que tienes'), nodo('dd', 'cifras', formatEuros(b.activos)),
    nodo('dt', '', 'Lo que debes'), nodo('dd', 'cifras', formatEuros(b.pasivos)),
    nodo('dt', '', 'Patrimonio neto'), nodo('dd', 'cifras destacado', formatEuros(b.neto)),
  )
  resumen.append(dl)
  caja.append(resumen)
}

/** @param {Estado} estado */
function pintarObjetivos(estado) {
  const caja = requerir('objetivos')

  if (objetivos.length === 0) {
    caja.replaceChildren(vacio(
      estado.capacidad.capacidad > 0
        ? `Puedes apartar unos ${formatEurosRedondo(estado.capacidad.capacidad)} al mes. `
          + 'Ponle nombre a eso y te digo cuándo llegas.'
        : 'Un objetivo es una cifra con una fecha. Apunta el primero y te digo cuándo llegas.',
    ))
    return
  }

  const ol = nodo('ol', 'objetivos pulsables')
  for (const o of objetivos) {
    const p = progresoDe(o, estado.hoy)
    const li = nodo('li', 'objetivo')
    li.dataset.objetivo = o.id
    li.tabIndex = 0
    li.setAttribute('role', 'button')

    const cabecera = nodo('div', 'mes-cabecera')
    cabecera.append(
      nodo('span', 'mes-nombre', o.nombre),
      nodo('span', 'cifras', `${formatEurosRedondo(o.ahorrado)} de ${formatEurosRedondo(o.meta)}`),
    )

    li.append(cabecera, barra(p.porcentaje), nodo('p', 'mes-aviso', cuandoLlegas(o, p)))
    ol.append(li)
  }
  caja.replaceChildren(ol)
}

/**
 * @param {Objetivo} o
 * @param {ReturnType<typeof progresoDe>} p
 */
function cuandoLlegas(o, p) {
  if (p.faltan === 0) return 'Conseguido.'
  if (p.meses === Infinity) {
    return `Faltan ${formatEurosRedondo(p.faltan)}. Dime cuánto apartas al mes y te digo cuándo llegas.`
  }
  const llegada = p.fechaLlegada ? `${fechaLarga(p.fechaLlegada)} de ${p.fechaLlegada.slice(0, 4)}` : ''
  if (!p.alcanzable && o.fechaMeta) {
    return `A ${formatEuros(o.aportacion)} al mes llegas el ${llegada}, más tarde de lo que querías. `
      + `Para llegar a tiempo harían falta ${formatEuros(p.aportacionNecesaria)} al mes.`
  }
  return `Faltan ${formatEurosRedondo(p.faltan)}. A este ritmo llegas el ${llegada}.`
}

/** @param {Apunte | null} apunte */
async function editarApunte(apunte) {
  const datos = await pedirDatos({
    titulo: apunte ? 'Editar partida' : 'Anotar una partida',
    aceptar: 'Guardar',
    borrable: apunte !== null,
    campos: [
      { nombre: 'nombre', etiqueta: 'Qué es', valor: apunte?.nombre, pista: 'Furgoneta, fondo indexado, préstamo…', requerido: true },
      {
        nombre: 'grupo',
        etiqueta: 'De qué tipo',
        tipo: 'lista',
        valor: apunte?.grupo ?? 'inversiones',
        opciones: ORDEN_GRUPOS.map((g) => /** @type {[string, string]} */ ([g, GRUPOS[g]])),
      },
      { nombre: 'valor', etiqueta: 'Cuánto vale hoy', tipo: 'numero', valor: apunte ? String(Math.abs(apunte.valor) / 100) : '', requerido: true },
      { nombre: 'fecha', etiqueta: 'A fecha de', tipo: 'fecha', valor: apunte?.fecha ?? hoyIso() },
    ],
  })

  if (datos === null) return
  if (datos === 'borrar') {
    if (apunte) await ganchos.alBorrarApunte(apunte.id)
    return
  }

  await ganchos.alGuardarApunte({
    id: apunte?.id ?? ganchos.nuevoId(),
    nombre: datos.nombre.trim(),
    grupo: /** @type {Apunte['grupo']} */ (datos.grupo),
    valor: Math.round(Number(datos.valor) * 100),
    fecha: datos.fecha || hoyIso(),
  })
}

/** @param {Objetivo | null} objetivo */
async function editarObjetivo(objetivo) {
  const datos = await pedirDatos({
    titulo: objetivo ? 'Editar objetivo' : 'Nuevo objetivo',
    borrable: objetivo !== null,
    campos: [
      { nombre: 'nombre', etiqueta: 'Para qué', valor: objetivo?.nombre, pista: 'Fondo de emergencia, viaje, camper…', requerido: true },
      { nombre: 'meta', etiqueta: 'Cuánto quieres juntar', tipo: 'numero', valor: objetivo ? String(objetivo.meta / 100) : '', requerido: true },
      { nombre: 'ahorrado', etiqueta: 'Cuánto llevas', tipo: 'numero', valor: objetivo ? String(objetivo.ahorrado / 100) : '0' },
      { nombre: 'aportacion', etiqueta: 'Cuánto apartas al mes', tipo: 'numero', valor: objetivo ? String(objetivo.aportacion / 100) : '' },
      { nombre: 'fechaMeta', etiqueta: 'Para cuándo (opcional)', tipo: 'fecha', valor: objetivo?.fechaMeta ?? '' },
    ],
  })

  if (datos === null) return
  if (datos === 'borrar') {
    if (objetivo) await ganchos.alBorrarObjetivo(objetivo.id)
    return
  }

  await ganchos.alGuardarObjetivo({
    id: objetivo?.id ?? ganchos.nuevoId(),
    nombre: datos.nombre.trim(),
    meta: Math.round(Number(datos.meta) * 100),
    ahorrado: Math.round(Number(datos.ahorrado || 0) * 100),
    aportacion: Math.round(Number(datos.aportacion || 0) * 100),
    ...(datos.fechaMeta ? { fechaMeta: datos.fechaMeta } : {}),
  })
}
