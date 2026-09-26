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
import { barra, nodo, requerir, vacio } from '../piezas.js'

/**
 * @typedef {ReturnType<typeof import('../../estado.js').construirEstado>} Estado
 */

/**
 * @type {{
 *   alGuardarColchon: (centimos: number) => Promise<void>,
 *   alGuardarPresupuesto: (categoria: string, centimos: number | null) => Promise<void>,
 * }}
 */
let ganchos

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

  pintarPresupuestos(estado)
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
