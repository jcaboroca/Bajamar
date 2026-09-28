// @ts-check
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { cuadre, proponerAsignado, recuadrar, residuoDelMes, ritmoDelPlan, sellar } from '../src/analisis/plan.js'
import { proyectar } from '../src/analisis/bajamar.js'

/**
 * @param {string} fecha
 * @param {number} importe
 * @param {string} categoria
 */
function ord(fecha, importe, categoria) {
  return { fecha, importe, categoria }
}

describe('el residuo del mes', () => {
  /** @type {import('../src/analisis/bajamar.js').Evento[]} */
  const eventos = [
    { fecha: '2026-10-20', importe: -75_000, nombre: 'Alquiler', tipo: 'compromiso', seguro: false },
    { fecha: '2026-10-22', importe: -12_000, nombre: 'Seguro', tipo: 'compromiso', seguro: false },
    { fecha: '2026-10-28', importe: 5_000, nombre: 'Devolución', tipo: 'bulto', seguro: true },
  ]

  test('es el saldo más lo que falta por cobrar menos lo que falta por pagar', () => {
    const r = residuoDelMes({ saldo: 200_000, eventos, hoy: '2026-10-15' })
    assert.equal(r, 200_000 - 75_000 - 12_000 + 5_000)
  })

  test('el colchón se aparta', () => {
    const r = residuoDelMes({ saldo: 200_000, eventos, hoy: '2026-10-15', reserva: 50_000 })
    assert.equal(r, 200_000 - 75_000 - 12_000 + 5_000 - 50_000)
  })

  test('lo ya gastado no se resta dos veces: ya está dentro del saldo', () => {
    // Mismo mes, mismos compromisos pendientes, pero el día 15 te has dejado
    // 30.000 en el súper. El banco ya lo descontó, así que lo único que cambia
    // es el saldo de partida y el residuo baja exactamente eso.
    const antes = residuoDelMes({ saldo: 200_000, eventos, hoy: '2026-10-15' })
    const despues = residuoDelMes({ saldo: 170_000, eventos, hoy: '2026-10-15' })
    assert.equal(antes - despues, 30_000)
  })

  test('puede ser negativo, y se dice', () => {
    const r = residuoDelMes({ saldo: 50_000, eventos, hoy: '2026-10-15' })
    assert.ok(r < 0)
  })
})

describe('la propuesta inicial', () => {
  // Dos meses cerrados: 300 en súper, 100 en restaurantes. El mes en curso
  // queda fuera por estar a medias, igual que al medir el goteo.
  const ordinarios = [
    ord('2026-08-05', -15_000, 'super'),
    ord('2026-08-20', -15_000, 'super'),
    ord('2026-08-10', -10_000, 'restaurantes'),
    ord('2026-09-05', -15_000, 'super'),
    ord('2026-09-20', -15_000, 'super'),
    ord('2026-09-10', -10_000, 'restaurantes'),
    ord('2026-10-02', -90_000, 'viajes'), // mes en curso: no cuenta
  ]

  test('propone lo que sueles gastar, no todo lo que tienes', () => {
    // Sueles gastar 800 al mes y tienes 12.000 en la cuenta: la propuesta son
    // 800, no 12.000. El resto se queda sin repartir, a la vista.
    const a = proponerAsignado(ordinarios, { habitualPorMes: -80_000, residuo: 1_200_000 })
    assert.equal(a.super, 60_000)      // pesó el 75%
    assert.equal(a.restaurantes, 20_000) // el 25%
    assert.equal(a.viajes, undefined)  // mes en curso, fuera
    assert.equal(Object.values(a).reduce((t, x) => t + x, 0), 80_000)
  })

  test('cuando la costumbre no cabe, se topa al residuo', () => {
    const a = proponerAsignado(ordinarios, { habitualPorMes: -80_000, residuo: 40_000 })
    assert.equal(Object.values(a).reduce((t, x) => t + x, 0), 40_000)
    assert.equal(a.super, 30_000)
    assert.equal(a.restaurantes, 10_000)
  })

  test('la suma cuadra al céntimo', () => {
    const a = proponerAsignado(ordinarios, { habitualPorMes: -77_777, residuo: 1_000_000 })
    assert.equal(Object.values(a).reduce((t, x) => t + x, 0), 77_777)
  })

  test('sin residuo no hay nada que repartir', () => {
    assert.deepEqual(proponerAsignado(ordinarios, { habitualPorMes: -80_000, residuo: 0 }), {})
    assert.deepEqual(proponerAsignado(ordinarios, { habitualPorMes: -80_000, residuo: -5_000 }), {})
  })
})

describe('el cuadre', () => {
  const plan = sellar({
    mes: '2026-10',
    asignado: { super: 60_000, restaurantes: 20_000 },
    residuo: 100_000,
    hoy: '2026-10-01',
  })

  test('lo que no repartes se ve', () => {
    const c = cuadre({ plan, residuo: 100_000 })
    assert.equal(c.asignado, 80_000)
    assert.equal(c.sinRepartir, 20_000)
    assert.equal(c.desajuste, 0)
    assert.equal(c.pasado, false)
  })

  test('cuando el residuo cambia se dice cuánto, y no se toca el reparto', () => {
    const c = cuadre({ plan, residuo: 96_000 })
    assert.equal(c.desajuste, -4_000)
    assert.equal(c.asignado, 80_000) // intacto
    assert.equal(c.sinRepartir, 16_000)
  })

  test('repartir más de lo que hay se marca', () => {
    const c = cuadre({ plan, residuo: 70_000 })
    assert.equal(c.pasado, true)
    assert.equal(c.sinRepartir, -10_000)
  })

  test('sin plan, todo el residuo está sin repartir', () => {
    const c = cuadre({ plan: null, residuo: 100_000 })
    assert.equal(c.asignado, 0)
    assert.equal(c.sinRepartir, 100_000)
    assert.equal(c.desajuste, 0)
  })
})

describe('recuadrar', () => {
  const plan = sellar({
    mes: '2026-10',
    asignado: { super: 60_000, restaurantes: 20_000 },
    residuo: 80_000,
    hoy: '2026-10-01',
  })

  test('encoge en proporción y vuelve a cuadrar al céntimo', () => {
    const nuevo = recuadrar(plan, 60_000)
    assert.equal(Object.values(nuevo).reduce((t, x) => t + x, 0), 60_000)
    assert.equal(nuevo.super, 45_000)
    assert.equal(nuevo.restaurantes, 15_000)
  })

  test('los céntimos sueltos van al trozo más gordo', () => {
    const nuevo = recuadrar(plan, 59_999)
    assert.equal(Object.values(nuevo).reduce((t, x) => t + x, 0), 59_999)
  })
})

describe('el ritmo sale del plan', () => {
  const plan = sellar({
    mes: '2026-10',
    asignado: { super: 60_000, restaurantes: 20_000 },
    residuo: 100_000,
    hoy: '2026-10-01',
  })

  test('sin plan no hay ritmo: manda el histórico como hasta ahora', () => {
    assert.equal(ritmoDelPlan({ plan: null, hoy: '2026-10-15' }), null)
  })

  test('cuenta lo que queda por gastar, no lo asignado', () => {
    const r = ritmoDelPlan({ plan, gastado: { super: 20_000 }, hoy: '2026-10-15' })
    assert.equal(r?.restante, 40_000 + 20_000)
  })

  test('una categoría agotada aporta cero, nunca negativo', () => {
    const r = ritmoDelPlan({ plan, gastado: { super: 95_000 }, hoy: '2026-10-15' })
    assert.equal(r?.restante, 20_000) // el exceso del súper no devuelve dinero
  })

  test('se reparte entre los días que quedan', () => {
    // Del 15 al 31 hay 16 días, que son los que `proyectar` va a cobrar.
    const r = ritmoDelPlan({ plan, gastado: {}, hoy: '2026-10-15' })
    assert.equal(r?.porDia, -Math.round(80_000 / 16))
  })

  test('el último día del mes no divide por cero', () => {
    const r = ritmoDelPlan({ plan, gastado: {}, hoy: '2026-10-31' })
    assert.equal(r?.porDia, 0)
  })
})

describe('el plan manda dentro de su mes y ni un día más', () => {
  // El ritmo del plan es «lo que queda entre los días que quedan». Extenderlo
  // al horizonte largo daría cifras absurdas: un día 30 sería el presupuesto
  // entero en un solo día, repetido durante un año.
  const DEL_PLAN = -1000
  const HISTORICO = -300
  const finDeMes = '2026-10-31'
  const gota = (/** @type {string} */ fecha) => (fecha <= finDeMes ? DEL_PLAN : HISTORICO)

  const proyeccion = proyectar({
    saldoInicial: 1_000_000,
    desde: '2026-10-29',
    hasta: '2026-11-03',
    ritmoPorDia: gota,
    eventos: [],
  })

  test('cada día lleva apuntado lo que de verdad goteó', () => {
    assert.deepEqual(
      proyeccion.curva.map((p) => [p.fecha, p.gota]),
      [
        ['2026-10-29', 0], // el saldo de partida no es un día vivido
        ['2026-10-30', DEL_PLAN],
        ['2026-10-31', DEL_PLAN],
        ['2026-11-01', HISTORICO],
        ['2026-11-02', HISTORICO],
        ['2026-11-03', HISTORICO],
      ],
    )
  })

  test('el saldo baja con el ritmo de cada tramo, no con uno solo', () => {
    assert.equal(proyeccion.saldoFinal, 1_000_000 + DEL_PLAN * 2 + HISTORICO * 3)
  })
})

describe('lo que no repartes no te lo gastas', () => {
  const base = { mes: '2026-10', residuo: 100_000, hoy: '2026-10-01' }

  /** @param {Record<string, number>} asignado */
  function sueloCon(asignado) {
    const plan = sellar({ ...base, asignado })
    const ritmo = ritmoDelPlan({ plan, hoy: '2026-10-01' })
    return proyectar({
      saldoInicial: 100_000,
      desde: '2026-10-01',
      hasta: '2026-10-31',
      ritmoPorDia: ritmo?.porDia ?? 0,
      eventos: [],
    }).suelo.saldo
  }

  test('repartir menos sube el suelo', () => {
    const todo = sueloCon({ super: 60_000, restaurantes: 40_000 })
    const recortado = sueloCon({ super: 60_000, restaurantes: 15_000 })
    assert.ok(recortado > todo)
    // Y sube justo lo que has dejado de repartir, salvo el redondeo del día.
    assert.ok(Math.abs((recortado - todo) - 25_000) <= 31)
  })
})
