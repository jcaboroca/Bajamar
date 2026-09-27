// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { repartirGasto } from '../src/analisis/reparto.js'

/**
 * @param {string} fecha
 * @param {number} importe
 * @param {string} categoria
 */
function mov(fecha, importe, categoria) {
  return /** @type {any} */ ({ id: `${fecha}-${categoria}`, fecha, importe, categoria })
}

describe('en qué se va el goteo', () => {
  test('los trozos suman el goteo al céntimo, pase lo que pase con el redondeo', () => {
    const ordinarios = []
    for (const mes of ['01', '02', '03']) {
      ordinarios.push(mov(`2026-${mes}-05`, -33333, 'super'))
      ordinarios.push(mov(`2026-${mes}-12`, -33333, 'restaurantes'))
      ordinarios.push(mov(`2026-${mes}-20`, -33334, 'ocio'))
    }
    ordinarios.push(mov('2026-04-02', -1000, 'super'))

    const trozos = repartirGasto(ordinarios, { porMes: -100000 })
    assert.equal(trozos.reduce((t, x) => t + x.alMes, 0), -100000)
  })

  test('una categoría que sólo pasa una vez al año no se queda en cero', () => {
    const ordinarios = []
    for (let i = 1; i <= 12; i += 1) {
      ordinarios.push(mov(`2026-${String(i).padStart(2, '0')}-05`, -10000, 'super'))
    }
    ordinarios.push(mov('2026-06-01', -60000, 'impuestos'))
    ordinarios.push(mov('2027-01-03', -100, 'super'))

    const trozos = repartirGasto(ordinarios, { porMes: -15000 })
    const impuestos = trozos.find((t) => t.categoria === 'impuestos')
    assert.ok(impuestos, 'la mediana de impuestos sería cero; su peso no lo es')
    assert.ok(impuestos.alMes < -4000, `esperaba un peso real, no ${impuestos.alMes}`)
  })

  test('el mes a medias no cuenta, igual que al medir el goteo', () => {
    const ordinarios = [
      mov('2026-01-05', -10000, 'super'),
      mov('2026-02-05', -10000, 'super'),
      mov('2026-03-01', -90000, 'viajes'),
    ]
    const trozos = repartirGasto(ordinarios, { porMes: -10000 })
    assert.deepEqual(trozos.map((t) => t.categoria), ['super'])
  })

  test('sin gasto medido no se inventa reparto', () => {
    assert.deepEqual(repartirGasto([], { porMes: -10000 }), [])
  })
})
