// @ts-check
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { detectarCompromisos, gastoOrdinario, ritmoOrdinario } from '../src/analisis/compromisos.js'
import { eventosDesde, proyectar, sumarDias } from '../src/analisis/bajamar.js'

/**
 * @param {string} fecha
 * @param {number} importe
 * @param {Partial<import('../src/dominio/tipos.js').Movimiento>} [extra]
 * @returns {import('../src/dominio/tipos.js').Movimiento}
 */
function mov(fecha, importe, extra = {}) {
  return {
    id: `${fecha}:${importe}:${Math.random()}`,
    fecha,
    fechaValor: fecha,
    conceptoRaw: 'x',
    entidadId: 'e',
    importe,
    saldo: null,
    origen: 'cuenta',
    localidad: null,
    fraccionado: false,
    excepcional: false,
    ...extra,
  }
}

const NOMBRES = new Map([['e', 'Entidad']])

describe('periodicidad', () => {
  test('un recibo mensual el mismo día se reconoce', () => {
    const { compromisos } = detectarCompromisos(
      ['2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'].map((f) => mov(f, -3800)),
      NOMBRES,
      { hoy: '2026-09-15' },
    )
    assert.equal(compromisos.length, 1)
    assert.equal(compromisos[0].periodicidad, 'mensual')
    assert.equal(compromisos[0].proximaPrevista, '2026-10-01')
    assert.equal(compromisos[0].estado, 'activo')
  })

  test('una racha estacional en días dispersos no es una mensualidad', () => {
    // Cinco compras en meses seguidos de invierno: los intervalos parecen
    // mensuales, pero los días del mes no se parecen en nada.
    const { compromisos } = detectarCompromisos(
      ['2026-01-04', '2026-02-17', '2026-03-09', '2026-04-25', '2026-05-11'].map((f) => mov(f, -4750)),
      NOMBRES,
      { hoy: '2026-09-15' },
    )
    assert.deepEqual(compromisos, [])
  })

  test('dos apariciones separadas por un año no bastan para llamarlo anual', () => {
    const { compromisos } = detectarCompromisos(
      [mov('2025-09-24', -58237), mov('2026-09-24', -58237)],
      NOMBRES,
      { hoy: '2026-09-28' },
    )
    assert.deepEqual(compromisos, [])
  })

  test('el importe esperado es la mediana, no la media ni el último', () => {
    const { compromisos } = detectarCompromisos(
      [
        mov('2026-05-10', -5000), mov('2026-06-10', -5500),
        mov('2026-07-10', -5500), mov('2026-08-10', -7000),
      ],
      NOMBRES,
      { hoy: '2026-08-20' },
    )
    assert.equal(compromisos[0].importeEsperado, -5500)
  })

  test('se marca retrasado cuando pasa el día con holgura', () => {
    const { compromisos } = detectarCompromisos(
      ['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01'].map((f) => mov(f, -82500)),
      NOMBRES,
      { hoy: '2026-08-20' },
    )
    assert.equal(compromisos[0].estado, 'retrasado')
    // Aunque falten periodos, nunca se anuncia una fecha ya pasada.
    assert.ok(compromisos[0].proximaPrevista >= '2026-08-20')
  })

  test('un mismo cobrador con dos recibos distintos da dos series', () => {
    const recibos = [
      ...['2026-03-05', '2026-06-05', '2026-09-05'].map((f) => mov(f, -33071)),
      ...['2026-04-05', '2026-07-05', '2026-10-05'].map((f) => mov(f, -8025)),
    ]
    const { compromisos } = detectarCompromisos(recibos, NOMBRES, { hoy: '2026-10-10' })
    assert.equal(compromisos.length, 2)
    const importes = compromisos.map((c) => c.importeEsperado).sort((a, b) => a - b)
    assert.deepEqual(importes, [-33071, -8025])
  })

  test('sólo se pregunta por lo que suele volver', () => {
    const seguro = [mov('2025-09-24', -58237)]
    const capricho = [mov('2025-09-24', -58237, { entidadId: 'otra' })]
    const nombres = new Map([['e', 'MAPFRE'], ['otra', 'Tienda de bicis']])
    const categorias = new Map([['e', 'seguros'], ['otra', 'compras']])

    const a = detectarCompromisos(seguro, nombres, { hoy: '2026-09-28', categorias })
    const b = detectarCompromisos(capricho, nombres, { hoy: '2026-09-28', categorias })
    assert.equal(a.dudosos.length, 1)
    assert.equal(a.dudosos[0].meses, 12)
    assert.deepEqual(b.dudosos, [])
  })
})

describe('gasto ordinario', () => {
  test('excluye lo comprometido, la tarjeta y lo excepcional', () => {
    const movimientos = [
      mov('2026-09-01', -3800),                              // comprometido
      mov('2026-09-02', -2000, { entidadId: 'super' }),       // ordinario
      mov('2026-09-03', -9000, { origen: 'tarjeta', entidadId: 'super' }),
      mov('2026-09-04', -50000, { entidadId: 'super', excepcional: true }),
      mov('2026-09-05', -50000, { entidadId: 'ahorro' }),     // traspaso
      mov('2026-09-06', 300000, { entidadId: 'super' }),      // ingreso
    ]
    const compromisos = [{ entidadId: 'e' }]
    const ordinarios = gastoOrdinario(
      movimientos,
      /** @type {any} */ (compromisos),
      new Set(['traspaso']),
      new Map([['ahorro', 'traspaso'], ['super', 'super']]),
    )
    assert.deepEqual(ordinarios.map((m) => m.importe), [-2000])
  })

  test('el mes en curso no cuenta para la mediana', () => {
    const movimientos = [
      mov('2026-07-10', -100000), mov('2026-08-10', -120000), mov('2026-09-01', -1000),
    ]
    const ritmo = ritmoOrdinario(movimientos)
    assert.equal(ritmo.meses, 2)
    assert.equal(ritmo.porMes, -110000)
  })
})

describe('proyección', () => {
  test('encuentra el suelo, no el cierre', () => {
    // Cierra el mes en positivo pero pasa por un agujero a mitad: ese agujero
    // es justamente lo que la aplicación existe para enseñar.
    const p = proyectar({
      saldoInicial: 100000,
      desde: '2026-10-01',
      hasta: '2026-10-31',
      ritmoPorDia: 0,
      eventos: [
        { fecha: '2026-10-05', importe: -150000, nombre: 'Recibo', tipo: 'compromiso', seguro: true },
        { fecha: '2026-10-25', importe: 250000, nombre: 'Nómina', tipo: 'ingreso', seguro: false },
      ],
    })
    assert.equal(p.suelo.saldo, -50000)
    assert.equal(p.suelo.fecha, '2026-10-05')
    assert.equal(p.saldoFinal, 200000)
  })

  test('el ritmo diario erosiona el saldo', () => {
    const p = proyectar({
      saldoInicial: 100000, desde: '2026-10-01', hasta: '2026-10-11',
      ritmoPorDia: -1000, eventos: [],
    })
    assert.equal(p.saldoFinal, 90000)
    assert.equal(p.suelo.fecha, '2026-10-11')
  })

  test('un compromiso mensual se repite dentro del horizonte', () => {
    const eventos = eventosDesde({
      compromisos: [/** @type {any} */ ({
        entidadId: 'e', nombre: 'Luz', periodicidad: 'mensual',
        importeEsperado: -4000, proximaPrevista: '2026-10-05', estado: 'activo',
      })],
      ingresos: [],
      bultos: [],
      tarjeta: null,
      desde: '2026-10-01',
      hasta: '2026-12-31',
    })
    assert.deepEqual(eventos.map((e) => e.fecha), ['2026-10-05', '2026-11-05', '2026-12-05'])
  })

  test('los eventos fuera del horizonte no entran', () => {
    const p = proyectar({
      saldoInicial: 0, desde: '2026-10-01', hasta: '2026-10-31', ritmoPorDia: 0,
      eventos: [{ fecha: '2026-11-15', importe: -99999, nombre: 'Tarde', tipo: 'bulto', seguro: true }],
    })
    assert.equal(p.saldoFinal, 0)
    assert.deepEqual(p.eventos, [])
  })

  test('sumarDias cruza el fin de mes y el año', () => {
    assert.equal(sumarDias('2026-10-31', 1), '2026-11-01')
    assert.equal(sumarDias('2026-12-31', 1), '2027-01-01')
    assert.equal(sumarDias('2028-02-28', 1), '2028-02-29')
  })
})

/**
 * Una cuota que termina no avisa. Si se sigue contando, la previsión enseña un
 * suelo más bajo del real y todo el propósito de la aplicación se cae.
 */
describe('recibos que se acaban', () => {
  const MENSUAL = ['2026-01-30', '2026-03-02', '2026-04-01', '2026-04-30', '2026-05-30']

  test('un mes sin pasar es un retraso, no un final', () => {
    const { compromisos } = detectarCompromisos(
      MENSUAL.map((f) => mov(f, -12550)), NOMBRES, { hoy: '2026-07-10' },
    )
    assert.equal(compromisos[0].estado, 'retrasado')
  })

  test('tres veces seguidas sin pasar es que se acabó', () => {
    const { compromisos } = detectarCompromisos(
      MENSUAL.map((f) => mov(f, -12550)), NOMBRES, { hoy: '2026-09-27' },
    )
    assert.equal(compromisos[0].estado, 'extinto')
  })

  test('la cuota vieja se apaga y la nueva sigue viva', () => {
    // Una financiación que se renueva con otro importe, tal como pasó de
    // verdad: trece cuotas, una liquidación de céntimos distintos, y la nueva.
    const vieja = [
      '2025-01-30', '2025-03-03', '2025-04-01', '2025-04-30', '2025-05-30', '2025-07-01',
      '2025-07-30', '2025-09-01', '2025-09-30', '2025-10-30', '2025-12-02', '2025-12-30',
      '2026-01-30',
    ]
    const nueva = ['2026-03-26', '2026-04-28', '2026-05-26', '2026-06-26', '2026-07-28', '2026-08-26']
    const { compromisos } = detectarCompromisos(
      [
        ...vieja.map((f) => mov(f, -12550)),
        mov('2026-03-03', -12538),
        ...nueva.map((f) => mov(f, -13495)),
      ],
      NOMBRES,
      { hoy: '2026-09-27' },
    )
    const porImporte = new Map(compromisos.map((c) => [c.importeEsperado, c.estado]))
    assert.equal(porImporte.get(-12550), 'extinto')
    assert.notEqual(porImporte.get(-13495), 'extinto')
  })

  test('un recibo anual no se da por muerto por tardar unos meses', () => {
    const { compromisos } = detectarCompromisos(
      ['2023-06-10', '2024-06-12', '2025-06-11', '2026-06-10'].map((f) => mov(f, -21000)),
      NOMBRES,
      { hoy: '2027-09-27' },
    )
    assert.equal(compromisos[0].estado, 'retrasado')
  })
})
