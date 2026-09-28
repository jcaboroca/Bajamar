// @ts-check
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { detallarPeriodos, residuoDe } from '../src/analisis/mensual.js'
import { periodosEntre } from '../src/analisis/periodos.js'
import { proyectar } from '../src/analisis/bajamar.js'

const HOY = '2026-09-28'
const NO_ES_GASTO = new Set(['traspaso', 'banco', 'nomina'])

/**
 * @param {string} fecha
 * @param {number} importe
 * @param {number | null} saldo
 * @param {string} [categoria]
 */
function mov(fecha, importe, saldo, categoria = 'super') {
  return {
    id: `${fecha}:${importe}`, fecha, fechaValor: fecha, conceptoRaw: 'x',
    entidadId: 'e', importe, saldo, origen: 'cuenta', localidad: null,
    fraccionado: false, excepcional: false, categoria,
  }
}

/*
 * Septiembre va del 25 de agosto al 24 de septiembre. Se entra con 2.290,18 €,
 * se va gastando, y el 25 de septiembre entra la nómina que abre octubre.
 */
const movimientos = [
  mov('2026-08-25', 280_000, 229_018, 'nomina'),
  mov('2026-09-01', -75_000, 154_018, 'vivienda'),
  mov('2026-09-10', -30_000, 124_018, 'super'),
  mov('2026-09-24', -19_152, 104_866, 'super'),
  mov('2026-09-25', 280_000, 384_866, 'nomina'),
  mov('2026-09-28', -10_000, 374_866, 'super'),
]

const proyeccion = proyectar({
  saldoInicial: 374_866,
  desde: HOY,
  hasta: '2026-10-31',
  ritmoPorDia: -1000,
  eventos: [
    { fecha: '2026-10-01', importe: -75_000, nombre: 'Alquiler', tipo: 'compromiso', seguro: false },
  ],
})

const periodos = periodosEntre({
  cortes: ['2026-08-25', '2026-09-25'],
  desde: '2026-08-25',
  hasta: '2026-10-31',
})

const detalle = detallarPeriodos({ periodos, movimientos, proyeccion, noEsGasto: NO_ES_GASTO, hoy: HOY })
const de = (id) => detalle.find((p) => p.id === id)

describe('cada periodo, contado entero', () => {
  test('septiembre va del 25 de agosto al 24 de septiembre', () => {
    assert.equal(de('2026-09')?.desde, '2026-08-25')
    assert.equal(de('2026-09')?.hasta, '2026-09-24')
    assert.equal(de('2026-09')?.dias, 31)
  })

  test('la nómina que abre el periodo es suya, sin desplazar nada', () => {
    // La del 25 de agosto paga septiembre y está dentro de septiembre.
    assert.equal(de('2026-09')?.ingresos.real, 280_000)
    // Y la del 25 de septiembre ya es de octubre.
    assert.equal(de('2026-10')?.ingresos.real, 280_000)
  })

  test('el gasto es el de sus días, ni uno más', () => {
    assert.equal(de('2026-09')?.gastos.real, -(75_000 + 30_000 + 19_152))
  })

  test('la curva empieza el primer día del periodo, no hoy', () => {
    const sept = de('2026-09')
    assert.equal(sept?.curva[0].fecha, '2026-08-25')
    assert.equal(sept?.curva[0].saldo, 229_018)
    assert.equal(sept?.curva.length, 31)
  })

  test('un día sin movimientos arrastra el saldo del anterior', () => {
    const sept = de('2026-09')
    assert.equal(sept?.curva.find((p) => p.fecha === '2026-09-05')?.saldo, 154_018)
  })

  test('la bajamar es el mínimo de esos días', () => {
    // El 24 quedaban 1.048,66 €, y es el punto más bajo de septiembre.
    assert.equal(de('2026-09')?.suelo.saldo, 104_866)
    assert.equal(de('2026-09')?.suelo.fecha, '2026-09-24')
  })

  test('cada periodo sabe en qué estado está', () => {
    assert.equal(de('2026-09')?.estado, 'cerrado')
    assert.equal(de('2026-10')?.estado, 'enCurso')
  })

  test('lo previsto es el total menos lo real, siempre', () => {
    for (const p of detalle) {
      assert.equal(p.ingresos.real + p.ingresos.previsto, p.ingresos.total, `ingresos de ${p.id}`)
      assert.equal(p.gastos.real + p.gastos.previsto, p.gastos.total, `gastos de ${p.id}`)
      assert.equal(p.ahorro, p.ingresos.total + p.gastos.total, `ahorro de ${p.id}`)
    }
  })

  test('un periodo cerrado no tiene nada previsto', () => {
    assert.equal(de('2026-09')?.ingresos.previsto, 0)
    assert.equal(de('2026-09')?.gastos.previsto, 0)
    assert.equal(de('2026-09')?.goteo, 0)
  })

  test('el goteo se separa de lo comprometido', () => {
    const oct = de('2026-10')
    assert.ok(oct)
    assert.equal(oct.goteo + oct.compromisos, oct.gastos.total)
    // El alquiler del 1 de octubre está dentro del periodo que abre el 25-sep.
    assert.ok(oct.compromisos <= -75_000)
  })
})

describe('lo que queda para el día a día', () => {
  test('es lo que cobras menos lo comprometido, sin sumar los ahorros', () => {
    const oct = de('2026-10')
    assert.ok(oct)
    assert.equal(residuoDe(oct), oct.ingresos.total + oct.compromisos)
    assert.notEqual(residuoDe(oct), oct.apertura + oct.ingresos.total + oct.compromisos)
  })

  test('el colchón se aparta, venga con el signo que venga', () => {
    const oct = de('2026-10')
    assert.ok(oct)
    assert.equal(residuoDe(oct, 50_000), residuoDe(oct) - 50_000)
    assert.equal(residuoDe(oct, -50_000), residuoDe(oct) - 50_000)
  })
})
