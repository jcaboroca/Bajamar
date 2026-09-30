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

describe('quién forma cada trozo', () => {
  const de = (/** @type {string} */ fecha, /** @type {number} */ importe, /** @type {string | null} */ entidadId) => (
    /** @type {any} */ ({ id: `${fecha}-${entidadId}-${importe}`, fecha, importe, categoria: 'compras', entidadId })
  )

  test('cada categoría dice qué comercios la llenan, de más caro a menos', () => {
    const trozos = repartirGasto([
      de('2026-07-03', -3000, 'amazon'),
      de('2026-07-20', -1000, 'decathlon'),
      de('2026-08-05', -3000, 'amazon'),
      de('2026-08-09', -1000, null),
      de('2026-09-01', -500, 'amazon'), // mes a medias: fuera
    ], { porMes: -4000 })
    const [compras] = trozos
    assert.deepEqual(compras.comercios.map((c) => c.entidadId), ['amazon', 'decathlon', ''])
    assert.deepEqual(compras.comercios.map((c) => c.cuantos), [2, 1, 1])
    // Misma escala que su trozo: Amazon es tres cuartos del gasto, así que tres
    // cuartos de lo que cuesta la categoría al mes.
    assert.equal(compras.comercios[0].alMes, -3000)
  })
})
