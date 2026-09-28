// @ts-check
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { curvaDelMes, detallarMeses, estaAcabado, residuoDe } from '../src/analisis/mensual.js'
import { porMeses } from '../src/analisis/mes.js'
import { proyectar } from '../src/analisis/bajamar.js'

const HOY = '2026-09-28'

/** @type {import('../src/analisis/bajamar.js').Evento[]} */
const eventos = [
  { fecha: '2026-10-01', importe: -75_000, nombre: 'Alquiler', tipo: 'compromiso', seguro: false },
  { fecha: '2026-10-25', importe: 280_000, nombre: 'Nómina', tipo: 'ingreso', seguro: false },
  { fecha: '2026-11-01', importe: -75_000, nombre: 'Alquiler', tipo: 'compromiso', seguro: false },
]

const proyeccion = proyectar({
  saldoInicial: 300_000,
  desde: HOY,
  hasta: '2026-11-30',
  ritmoPorDia: -1000,
  eventos,
})

/**
 * Lo real: sólo septiembre tiene extracto detrás. Octubre cobra la nómina que
 * ya entró el 25 de septiembre, así que su parte real no es cero.
 * @param {string} mes
 */
const resumenDe = (mes) => ({
  mes,
  ingresos: { real: mes === '2026-09' ? 100_000 : mes === '2026-10' ? 280_000 : 0, previsto: 0, total: 0 },
  gastos: { real: mes === '2026-09' ? -40_000 : 0, previsto: 0, total: 0 },
  ahorro: 0,
  apartado: 0,
  movimientos: 0,
})

const detalle = detallarMeses({ meses: porMeses(proyeccion), proyeccion, resumenDe, hoy: HOY })
const de = (mes) => detalle.find((m) => m.mes === mes)

describe('el resumen mes a mes', () => {
  test('sale un mes por cada mes tocado, y cada uno sabe en qué estado está', () => {
    assert.deepEqual(detalle.map((m) => [m.mes, m.estado]), [
      ['2026-09', 'enCurso'],
      ['2026-10', 'futuro'],
      ['2026-11', 'futuro'],
    ])
  })

  test('lo previsto es el total menos lo real, siempre', () => {
    for (const m of detalle) {
      assert.equal(m.ingresos.real + m.ingresos.previsto, m.ingresos.total, `ingresos de ${m.mes}`)
      assert.equal(m.gastos.real + m.gastos.previsto, m.gastos.total, `gastos de ${m.mes}`)
    }
  })

  test('un mes futuro es previsión entera', () => {
    const noviembre = de('2026-11')
    assert.equal(noviembre?.ingresos.real, 0)
    assert.equal(noviembre?.gastos.real, 0)
    assert.equal(noviembre?.gastos.previsto, noviembre?.gastos.total)
  })

  test('el goteo se separa de lo comprometido', () => {
    const octubre = de('2026-10')
    // 31 días de octubre a 10 € el día.
    assert.equal(octubre?.goteo, -31_000)
    // Y lo que queda son los recibos: el alquiler.
    assert.equal(octubre?.compromisos, -75_000)
    assert.equal(octubre?.goteo + octubre?.compromisos, octubre?.gastos.total)
  })

  test('con cuánto entras en un mes es con lo que cerraste el anterior', () => {
    const septiembre = de('2026-09')
    const octubre = de('2026-10')
    // El primero empieza hoy, no el día 1: se entra con el saldo de hoy.
    assert.equal(septiembre?.apertura, 300_000)
    assert.equal(octubre?.apertura, septiembre?.saldoFinal)
    assert.equal(de('2026-11')?.apertura, octubre?.saldoFinal)
  })

  test('el ahorro del mes es lo que entra menos lo que sale', () => {
    for (const m of detalle) {
      assert.equal(m.ahorro, m.ingresos.total + m.gastos.total, `ahorro de ${m.mes}`)
    }
  })
})

describe('lo que queda para el día a día de un mes entero', () => {
  test('es lo que cobras menos lo comprometido, sin sumar los ahorros', () => {
    const octubre = de('2026-10')
    assert.ok(octubre)
    assert.equal(residuoDe(octubre), octubre.ingresos.total + octubre.compromisos)
    // Con lo que entras al mes se enseña al lado, pero no se reparte: si se
    // sumara, tener ahorros diría que puedes gastártelos este mes.
    assert.ok(octubre.apertura > 0)
    assert.notEqual(residuoDe(octubre), octubre.apertura + octubre.ingresos.total + octubre.compromisos)
  })

  test('el colchón se aparta, venga con el signo que venga', () => {
    const octubre = de('2026-10')
    assert.ok(octubre)
    const base = residuoDe(octubre)
    assert.equal(residuoDe(octubre, 50_000), base - 50_000)
    assert.equal(residuoDe(octubre, -50_000), base - 50_000)
  })
})

describe('cuándo se da un mes por acabado', () => {
  test('el último día ya cuenta como cerrado: es cuando se dice lo ahorrado', () => {
    assert.equal(estaAcabado('2026-09', '2026-09-29'), false)
    assert.equal(estaAcabado('2026-09', '2026-09-30'), true)
    assert.equal(estaAcabado('2026-09', '2026-10-05'), true)
  })

  test('febrero no tiene día 30', () => {
    assert.equal(estaAcabado('2026-02', '2026-02-28'), true)
  })
})

describe('la curva de un mes entero', () => {
  // Septiembre de verdad: se entra con 2.290,18 €, se va gastando, y el 25
  // entra la nómina, que es el dinero de octubre. Hoy es 28.
  const movimientos = [
    { fecha: '2026-08-31', saldo: 229_018, importe: 0 },
    { fecha: '2026-09-05', saldo: 180_000, importe: -49_018 },
    { fecha: '2026-09-24', saldo: 104_866, importe: -75_134 },
    { fecha: '2026-09-25', saldo: 384_866, importe: 280_000 }, // nómina
    { fecha: '2026-09-28', saldo: 374_866, importe: -10_000 },
  ]
  const proyeccion = proyectar({
    saldoInicial: 374_866, desde: '2026-09-28', hasta: '2026-10-31',
    ritmoPorDia: -1000, eventos: [],
  })
  const { curva, suelo } = curvaDelMes({
    mes: '2026-09',
    movimientos,
    proyeccion,
    hoy: '2026-09-28',
    desplazados: [{ fecha: '2026-09-25', importe: 280_000 }],
  })
  const dia = (d) => curva.find((p) => p.fecha === `2026-09-${d}`)

  test('empieza el día 1 y acaba el último, pase lo que pase', () => {
    assert.equal(curva[0].fecha, '2026-09-01')
    assert.equal(curva[curva.length - 1].fecha, '2026-09-30')
    assert.equal(curva.length, 30)
  })

  test('se entra con el saldo del último apunte del mes anterior', () => {
    assert.equal(dia('01').saldo, 229_018)
  })

  test('un día sin movimientos arrastra el saldo del anterior', () => {
    assert.equal(dia('06').saldo, 180_000)
    assert.equal(dia('23').saldo, 180_000)
  })

  test('los días vividos salen del extracto, no de la previsión', () => {
    assert.equal(dia('24').saldo, 104_866)
    assert.equal(dia('25').saldo, 384_866)
  })

  test('la línea del banco sube el 25; la del dinero del mes no', () => {
    assert.equal(dia('25').saldo, 384_866)
    assert.equal(dia('25').propio, 384_866 - 280_000)
    // Antes de que entre, las dos son la misma.
    assert.equal(dia('24').saldo, dia('24').propio)
  })

  test('la bajamar del mes es el mínimo sin contar la nómina', () => {
    // El 24 quedaban 1.048,66 €, y del 25 en adelante se sigue gastando sin
    // que la nómina cuente, así que el suelo está al final del mes.
    assert.ok(suelo.saldo <= 104_866)
    assert.equal(suelo.saldo, Math.min(...curva.map((p) => p.propio)))
  })

  test('sin la nómina desplazada, las dos líneas son la misma', () => {
    const { curva: igual } = curvaDelMes({
      mes: '2026-09', movimientos, proyeccion, hoy: '2026-09-28', desplazados: [],
    })
    for (const p of igual) assert.equal(p.saldo, p.propio, p.fecha)
  })
})
