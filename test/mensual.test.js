// @ts-check
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { detallarPeriodos, residuoDe } from '../src/analisis/mensual.js'
import { periodosEntre } from '../src/analisis/periodos.js'
import { proyectar } from '../src/analisis/bajamar.js'

const HOY = '2026-09-28'
/** Qué apuntes son día a día: en estos fixtures, los de super. */
const ordinariosDe = (ms) => new Set(ms.filter((m) => m.categoria === 'super').map((m) => m.id))

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

const detalle = detallarPeriodos({ periodos, movimientos, proyeccion, ordinarios: ordinariosDe(movimientos), hoy: HOY })
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
    assert.equal(de('2026-09')?.diaADia, de('2026-09')?.diaADiaGastado)
  })

  test('lo que sale con fecha se separa del día a día', () => {
    const oct = de('2026-10')
    assert.ok(oct)
    assert.equal(oct.diaADia + oct.compromisos, oct.gastos.total)
    // El alquiler del 1 de octubre está dentro del periodo que abre el 25-sep.
    assert.ok(oct.compromisos <= -75_000)
  })
})

describe('lo que queda para el día a día', () => {
  test('es el saldo, más lo que entra, menos lo que sale con fecha', () => {
    const oct = de('2026-10')
    assert.ok(oct)
    assert.equal(residuoDe(oct), oct.apertura + oct.ingresos.total + oct.compromisos)
  })

  test('el colchón se aparta, venga con el signo que venga', () => {
    const oct = de('2026-10')
    assert.ok(oct)
    assert.equal(residuoDe(oct, 50_000), residuoDe(oct) - 50_000)
    assert.equal(residuoDe(oct, -50_000), residuoDe(oct) - 50_000)
  })
})

describe('con cuánto se entra en un periodo', () => {
  // El periodo empieza el día que entra la nómina, así que el saldo de ese
  // día ya la lleva dentro. Tomarlo como apertura la contaba dos veces: una
  // en «empiezas con» y otra en «lo que entra».
  const movs = [
    mov('2026-08-20', -5_000, 65_153, 'super'),   // antes del periodo
    mov('2026-08-25', 280_000, 345_153, 'nomina'), // la nómina que lo abre
    mov('2026-09-10', -40_000, 305_153, 'super'),
  ]
  const proy = proyectar({
    saldoInicial: 305_153, desde: HOY, hasta: '2026-10-31', ritmoPorDia: 0, eventos: [],
  })
  const [septiembre] = detallarPeriodos({
    periodos: periodosEntre({ cortes: ['2026-08-25'], desde: '2026-08-25', hasta: '2026-09-24' }),
    movimientos: movs,
    proyeccion: proy,
    ordinarios: ordinariosDe(movs),
    hoy: HOY,
  })

  test('es el saldo de antes del primer día, no el de ese día', () => {
    assert.equal(septiembre.apertura, 65_153)
    // El del primer día ya incluye la nómina, y ése es el que dibuja la curva.
    assert.equal(septiembre.curva[0].saldo, 345_153)
  })

  test('así la cuenta cuadra: entras, sumas lo que entra, restas lo que sale', () => {
    const esperado = septiembre.apertura + septiembre.ingresos.total + septiembre.gastos.total
    assert.equal(esperado, septiembre.saldoFinal)
  })
})

describe('la cuenta cuadra con el banco, pase lo que pase', () => {
  // La razón de que antes no cuadrara: los traspasos salían de la cuenta pero
  // no contaban como gasto, así que la resta daba una cosa y el saldo otra.
  const movs = [
    mov('2026-08-20', -5_000, 100_000, 'super'),
    mov('2026-08-25', 280_000, 380_000, 'nomina'),
    mov('2026-08-26', -50_000, 330_000, 'traspaso'),  // a la inversión
    mov('2026-08-27', -46_800, 283_200, 'traspaso'),  // el crédito de la furgo
    mov('2026-09-02', -1_200, 282_000, 'banco'),      // comisión
    mov('2026-09-10', -40_000, 242_000, 'super'),     // día a día
  ]
  const [septiembre] = detallarPeriodos({
    periodos: periodosEntre({ cortes: ['2026-08-25'], desde: '2026-08-25', hasta: '2026-09-24' }),
    movimientos: movs,
    proyeccion: proyectar({ saldoInicial: 242_000, desde: HOY, hasta: '2026-10-31', ritmoPorDia: 0, eventos: [] }),
    ordinarios: ordinariosDe(movs),
    hoy: HOY,
  })

  test('entras con, más lo que entra, menos todo lo que sale, da el saldo final', () => {
    assert.equal(
      septiembre.apertura + septiembre.ingresos.total + septiembre.gastos.total,
      septiembre.saldoFinal,
    )
  })

  test('los traspasos y las comisiones salen con fecha, no son día a día', () => {
    assert.equal(septiembre.compromisos, -(50_000 + 46_800 + 1_200))
    assert.equal(septiembre.diaADiaGastado, -40_000)
  })

  test('lo que queda para el día a día descuenta también los traspasos', () => {
    // 1.000 de saldo + 2.800 de nómina − 980 de traspasos y comisión.
    assert.equal(residuoDe(septiembre), 100_000 + 280_000 - 98_000)
  })
})

describe('un euro que entra es un ingreso, venga de donde venga', () => {
  // El banco te abona los 468 € que acaba de cobrarte y luego te los cobra en
  // tres cuotas. El bloque se llama «nómina y otros ingresos» y ese abono es
  // de los otros: esconderlo entre los recibos hacía que la suma de la lista
  // no diera lo que ponía en la línea.
  const movs = [
    mov('2026-08-20', -5_000, 100_000, 'super'),
    mov('2026-08-25', 280_000, 380_000, 'nomina'),
    mov('2026-08-28', -46_800, 333_200, 'tarjeta'),   // la liquidación
    { ...mov('2026-08-28', 46_800, 380_000, 'tarjeta'), fraccionado: true },
  ]
  const [septiembre] = detallarPeriodos({
    periodos: periodosEntre({ cortes: ['2026-08-25'], desde: '2026-08-25', hasta: '2026-09-24' }),
    movimientos: movs,
    proyeccion: proyectar({ saldoInicial: 380_000, desde: HOY, hasta: '2026-10-31', ritmoPorDia: 0, eventos: [] }),
    ordinarios: ordinariosDe(movs),
    hoy: HOY,
  })

  test('el abono va con los ingresos, junto a la nómina', () => {
    assert.equal(septiembre.ingresos.total, 280_000 + 46_800)
  })

  test('la liquidación que deshace sigue estando entre lo que sale con fecha', () => {
    assert.equal(septiembre.compromisos, -46_800)
  })

  test('y la cuenta sigue cuadrando con el banco', () => {
    assert.equal(
      septiembre.apertura + septiembre.ingresos.total + septiembre.gastos.total,
      septiembre.saldoFinal,
    )
  })
})

describe('un recibo que vence hoy y aún no ha llegado al banco', () => {
  /*
   * La proyección lo descuenta desde su primer día, porque el saldo del
   * extracto todavía no lo lleva. Si la cascada lo dejaba fuera por no ser
   * «posterior a hoy», la resta y el gráfico decían cosas distintas: en un
   * caso real fueron 717 € de diferencia entre lo que ponía el bloque y lo
   * que dibujaba la lámina.
   */
  const movs = [
    mov('2026-09-24', -19_152, 104_866, 'super'),
    mov('2026-09-25', 280_000, 384_866, 'nomina'),
    mov('2026-09-28', -10_000, 374_866, 'super'),
  ]
  const conRecibo = proyectar({
    saldoInicial: 374_866,
    desde: HOY,
    hasta: '2026-10-24',
    ritmoPorDia: 0,
    eventos: [
      { fecha: HOY, importe: -58_237, nombre: 'MAPFRE' },
      { fecha: '2026-10-10', importe: -46_800, nombre: 'Crédito furgoneta' },
    ],
  })
  const [octubre] = detallarPeriodos({
    periodos: periodosEntre({ cortes: ['2026-09-25'], desde: '2026-09-25', hasta: '2026-10-24' }),
    movimientos: movs,
    proyeccion: conRecibo,
    ordinarios: ordinariosDe(movs),
    hoy: HOY,
  })

  test('cuenta entre lo que sale con fecha, igual que lo cuenta la curva', () => {
    assert.equal(octubre.compromisos, -(58_237 + 46_800))
  })

  test('la resta del bloque da lo mismo que el final de la lámina', () => {
    assert.equal(
      octubre.apertura + octubre.ingresos.total + octubre.gastos.total,
      octubre.saldoFinal,
    )
  })
})
