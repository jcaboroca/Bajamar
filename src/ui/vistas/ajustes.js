// @ts-check
/**
 * Ajustes: los datos, el colchón y los presupuestos.
 *
 * El colchón es el número que convierte una previsión en un aviso. Sin él
 * sólo se puede avisar de un descubierto, que ya es tarde; con él se avisa de
 * acercarse a la cifra por debajo de la cual el usuario no duerme.
 *
 * Los presupuestos vienen propuestos con lo que ya se gasta de verdad, no con
 * un ideal. Un presupuesto que nace incumplido no se cumple nunca.
 */

import { formatEuros } from '../../dominio/dinero.js'
import { CATEGORIAS } from '../../entidades/semillas.js'
import { barra, nodo, requerir, vacio } from '../piezas.js'

/**
 * @typedef {ReturnType<typeof import('../../estado.js').construirEstado>} Estado
 */

/**
 * @type {{
 *   alGuardarColchon: (centimos: number) => Promise<void>,
 *   alGuardarPresupuesto: (categoria: string, centimos: number | null) => Promise<void>,
 *   alClasificar: (entidadId: string, categoria: string) => Promise<void>,
 *   alMarcarUnico: (entidadId: string, esUnico: boolean) => Promise<void>,
 * }}
 */
let ganchos

/** Cuántos cobradores sin clasificar se enseñan antes de pedir permiso. */
const DE_ENTRADA = 25
let todos = false

/** @param {typeof ganchos} enganches */
export function montarAjustes(enganches) {
  ganchos = enganches

  requerir('colchon-guardar').addEventListener('click', async () => {
    const campo = requerir('colchon-campo')
    if (!(campo instanceof HTMLInputElement)) return
    await ganchos.alGuardarColchon(Math.max(0, Math.round(Number(campo.value || 0) * 100)))
  })

  requerir('presupuestos').addEventListener('change', async (e) => {
    const campo = e.target
    if (!(campo instanceof HTMLInputElement)) return
    const categoria = campo.dataset.categoria
    if (!categoria) return
    const valor = campo.value.trim()
    await ganchos.alGuardarPresupuesto(categoria, valor === '' ? null : Math.round(Number(valor) * 100))
  })

  requerir('sin-clasificar').addEventListener('change', async (e) => {
    const campo = e.target
    if (campo instanceof HTMLInputElement && campo.dataset.unico) {
      return ganchos.alMarcarUnico(campo.dataset.unico, campo.checked)
    }
    if (!(campo instanceof HTMLSelectElement)) return
    const entidadId = campo.dataset.entidad
    if (!entidadId || campo.value === '') return
    await ganchos.alClasificar(entidadId, campo.value)
  })

  requerir('sin-clasificar-mas').addEventListener('click', (e) => {
    todos = true
    if (e.target instanceof HTMLElement) e.target.hidden = true
  })
}

/**
 * @param {Estado} estado
 * @param {number} colchon
 */
export function pintarAjustes(estado, colchon) {
  requerir('dato-movimientos').textContent = String(estado.movimientos.length)
  requerir('dato-ritmo').textContent = `${formatEuros(estado.ritmo.porMes)} / mes`
  requerir('dato-saldo').textContent = formatEuros(estado.saldoInicial)

  const campo = requerir('colchon-campo')
  if (campo instanceof HTMLInputElement && document.activeElement !== campo) {
    campo.value = colchon > 0 ? String(colchon / 100) : ''
  }

  pintarSinClasificar(estado)
  pintarPresupuestos(estado)
}

/**
 * Una batería solar, un regalo o un viaje del año pasado salieron de la cuenta
 * pero no dicen nada de lo que viene. Marcarlos aquí los deja en el historial y
 * los saca de la previsión. Va antes de la categoría a propósito: al elegirla,
 * la fila deja de estar pendiente y desaparece.
 * @param {string} entidadId
 * @param {string} nombre
 * @param {boolean} marcado
 */
function casillaUnaVez(entidadId, nombre, marcado) {
  const etiqueta = nodo('label', 'clasificar-unico')
  const casilla = document.createElement('input')
  casilla.type = 'checkbox'
  casilla.dataset.unico = entidadId
  casilla.checked = marcado
  casilla.setAttribute('aria-label', `${nombre} no va a repetirse`)
  etiqueta.append(casilla, nodo('span', '', 'Fue una vez, no va a repetirse'))
  return etiqueta
}

/**
 * El reparto del gasto por categorías vale lo que valga esta lista: cada euro
 * que sigue aquí es un euro del que no se puede decir en qué se va.
 * @param {Estado} estado
 */
function pintarSinClasificar(estado) {
  const lista = requerir('sin-clasificar')
  const resumen = requerir('sin-clasificar-resumen')
  const mas = requerir('sin-clasificar-mas')
  const pendientes = estado.sinClasificar

  if (pendientes.length === 0) {
    resumen.textContent = 'Nada pendiente: sé en qué se va cada euro que sale.'
    lista.replaceChildren()
    mas.hidden = true
    return
  }

  const total = pendientes.reduce((a, p) => a + p.total, 0)
  const meses = Math.max(estado.ritmo.meses, 1)
  resumen.textContent = `${formatEuros(total / meses)} al mes que no sé dónde meter, `
    + `repartidos en ${pendientes.length} sitios. Empieza por arriba: los primeros pesan.`

  const visibles = todos ? pendientes : pendientes.slice(0, DE_ENTRADA)
  mas.hidden = todos || pendientes.length <= DE_ENTRADA
  if (!mas.hidden) mas.textContent = `Ver los ${pendientes.length - DE_ENTRADA} restantes`

  lista.replaceChildren(...visibles.map((p) => {
    const li = nodo('li', 'clasificar-fila')

    const cabecera = nodo('div', 'mes-cabecera')
    cabecera.append(nodo('span', 'mes-nombre', p.nombre))
    cabecera.append(nodo('span', 'cifras', formatEuros(p.total)))
    li.append(cabecera)

    const veces = p.cuantos === 1 ? 'una sola vez' : `${p.cuantos} veces`
    li.append(nodo('p', 'mes-aviso', `${veces}, la última el ${p.ultima}`))

    li.append(casillaUnaVez(p.entidadId, p.nombre, estado.unicos[p.entidadId] === true))

    const menu = document.createElement('select')
    menu.className = 'campo'
    menu.dataset.entidad = p.entidadId
    menu.setAttribute('aria-label', `En qué va ${p.nombre}`)
    const ninguna = document.createElement('option')
    ninguna.value = ''
    ninguna.textContent = '¿En qué va?'
    menu.append(ninguna)
    for (const [id, nombre] of Object.entries(CATEGORIAS)) {
      if (id === 'otros') continue
      const opcion = document.createElement('option')
      opcion.value = id
      opcion.textContent = nombre
      menu.append(opcion)
    }
    li.append(menu)
    return li
  }))
}

/** @param {Estado} estado */
function pintarPresupuestos(estado) {
  const lista = requerir('presupuestos')

  if (estado.presupuestos.length === 0) {
    lista.replaceChildren(vacio(
      'Necesito un par de meses cerrados de movimientos para saber lo que sueles '
      + 'gastar en cada cosa. Sin eso, cualquier presupuesto que te propusiera sería inventado.',
    ))
    return
  }

  lista.replaceChildren(...estado.presupuestos.map((p) => {
    const li = nodo('li', `presupuesto${p.porcentaje > 100 ? ' pasada' : ''}`)

    const cabecera = nodo('div', 'mes-cabecera')
    cabecera.append(nodo('span', 'mes-nombre', p.nombre))

    const caja = nodo('div', 'campo-linea')
    const campo = document.createElement('input')
    campo.type = 'number'
    campo.className = 'campo campo-corto cifras'
    campo.min = '0'
    campo.step = '10'
    campo.inputMode = 'numeric'
    campo.dataset.categoria = p.id
    campo.setAttribute('aria-label', `Presupuesto de ${p.nombre}`)
    if (!p.propuesto) campo.value = String(p.presupuesto / 100)
    campo.placeholder = String(Math.round(p.presupuesto / 100))
    caja.append(campo, nodo('span', 'sufijo', '€ / mes'))
    cabecera.append(caja)

    li.append(cabecera, barra(p.porcentaje))

    const pie = p.propuesto
      ? `Llevas ${formatEuros(p.gastado)} este mes. Sueles gastar ${formatEuros(p.habitual)}.`
      : p.disponible >= 0
        ? `Llevas ${formatEuros(p.gastado)}. Te quedan ${formatEuros(p.disponible)}.`
        : `Llevas ${formatEuros(p.gastado)}: ${formatEuros(Math.abs(p.disponible))} por encima.`

    li.append(nodo('p', 'mes-aviso', pie))
    return li
  }))
}
