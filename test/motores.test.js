// @ts-check
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { describirFijos, estructura, MESES_DE } from '../src/analisis/fijos.js'
import { cascadaDelMes, mesEnCurso } from '../src/analisis/cascada.js'
import { cuotasPendientes } from '../src/analisis/fraccionados.js'
import { conGotaDiaria, disponibleReal, porMeses, resumenDeMes } from '../src/analisis/mes.js'
import { revisarPresupuestos } from '../src/analisis/presupuestos.js'
import { capacidadDeAhorro, progresoDe } from '../src/analisis/objetivos.js'
import { balance, evolucion, variacion, vigentes } from '../src/analisis/patrimonio.js'
import { revisar } from '../src/analisis/alertas.js'
import { proyectar } from '../src/analisis/bajamar.js'

const NO_ES_GASTO = new Set(['traspaso', 'banco', 'nomina'])

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

/**
 * @param {Partial<import('../src/dominio/tipos.js').Compromiso>} [extra]
 * @returns {import('../src/dominio/tipos.js').Compromiso}
 */
function compromiso(extra = {}) {
  return {
    entidadId: 'e',
    nombre: 'Algo',
    periodicidad: 'mensual',
    importeEsperado: -3000,
    ultimaVista: '2026-09-01',
    proximaPrevista: '2026-10-01',
    observaciones: 5,
    estado: 'activo',
    ...extra,
  }
}

describe('coste mensual equivalente', () => {
  test('un seguro anual de 600 € son 50 € al mes', () => {
    const [fijo] = describirFijos(
      [compromiso({ periodicidad: 'anual', importeEsperado: -60_000 })],
      [],
      new Map([['e', 'seguros']]),
    )
    assert.equal(fijo.mensualEquivalente, -5000)
    assert.equal(fijo.categoria, 'seguros')
  })

  test('un recibo mensual se queda como está', () => {
    const [fijo] = describirFijos([compromiso({ importeEsperado: -7500 })], [], new Map())
    assert.equal(fijo.mensualEquivalente, -7500)
  })

  test('la luz varía y no se da por estable', () => {
    const importes = [-4000, -9000, -12_000, -5000, -11_000]
    const [fijo] = describirFijos(
      [compromiso({ importeEsperado: -9000 })],
      importes.map((v, i) => mov(`2026-0${i + 1}-10`, v)),
      new Map(),
    )
    assert.equal(fijo.estable, false)
  })

  test('un recibo clavado sí es estable', () => {
    const [fijo] = describirFijos(
      [compromiso({ importeEsperado: -1799 })],
      ['2026-06-05', '2026-07-05', '2026-08-05', '2026-09-05'].map((f) => mov(f, -1799)),
      new Map(),
    )
    assert.equal(fijo.estable, true)
    assert.equal(fijo.variacion, 0)
  })
})

describe('estructura de gasto', () => {
  const fijos = describirFijos(
    [
      compromiso({ entidadId: 'a', nombre: 'Alquiler', importeEsperado: -75_000 }),
      compromiso({ entidadId: 'b', nombre: 'Netflix', importeEsperado: -1799 }),
      compromiso({ entidadId: 'c', nombre: 'Seguro', periodicidad: 'anual', importeEsperado: -60_000 }),
      compromiso({ entidadId: 'd', nombre: 'Basuras', periodicidad: 'trimestral', importeEsperado: -9000 }),
      compromiso({ entidadId: 'z', nombre: 'Nómina', importeEsperado: 280_000 }),
    ],
    [],
    new Map([['b', 'suscripciones']]),
  )
  const resultado = estructura(fijos)

  test('los ingresos no son coste', () => {
    assert.equal(resultado.mensuales.some((f) => f.nombre === 'Nómina'), false)
  })

  test('el coste mensual suma los equivalentes, no los recibos', () => {
    // 750 + 17,99 + 50 (seguro/12) + 30 (basuras/3)
    assert.equal(resultado.costeMensual, -(75_000 + 1799 + 5000 + 3000))
  })

  test('la reserva sólo cuenta lo que no es mensual', () => {
    assert.equal(resultado.reservaMensual, -(5000 + 3000))
  })

  test('las suscripciones se leen aparte y al año', () => {
    assert.equal(resultado.suscripcionesMes, -1799)
    assert.equal(resultado.suscripcionesAnio, -1799 * 12)
  })

  test('un recibo anual no aparece entre los mensuales', () => {
    assert.deepEqual(resultado.anuales.map((f) => f.nombre), ['Seguro'])
    assert.deepEqual(resultado.periodicos.map((f) => f.nombre), ['Basuras'])
  })
})

describe('el mes en dos mitades', () => {
  const movimientos = [
    mov('2026-09-01', 280_000, { entidadId: 'n' }),
    mov('2026-09-03', -75_000, { entidadId: 'a' }),
    mov('2026-09-05', -12_000, { entidadId: 'a' }),
    mov('2026-09-06', -50_000, { entidadId: 't' }), // traspaso al ahorro
    mov('2026-08-30', -99_999, { entidadId: 'a' }), // otro mes
  ]
  const categorias = new Map([['n', 'nomina'], ['a', 'super'], ['t', 'traspaso']])

  /** @type {import('../src/analisis/bajamar.js').Evento[]} */
  const eventos = [
    { fecha: '2026-09-25', importe: -20_000, nombre: 'Luz', tipo: 'compromiso', seguro: false },
    { fecha: '2026-09-28', importe: 10_000, nombre: 'Devolución', tipo: 'bulto', seguro: true },
    { fecha: '2026-09-05', importe: -1, nombre: 'Ya pasó', tipo: 'compromiso', seguro: false },
  ]

  const r = resumenDeMes({ movimientos, categorias, noEsGasto: NO_ES_GASTO, eventos, mes: '2026-09', hoy: '2026-09-15' })

  test('no se cuela el mes anterior', () => {
    assert.equal(r.gastos.real, -87_000)
  })

  test('el traspaso al ahorro no es gasto pero se anota', () => {
    assert.equal(r.apartado, -50_000)
  })

  test('lo ya ocurrido no se vuelve a prever', () => {
    assert.equal(r.gastos.previsto, -20_000)
    assert.equal(r.ingresos.previsto, 10_000)
  })

  test('el ahorro es lo que queda al final', () => {
    assert.equal(r.ahorro, (280_000 + 10_000) + (-87_000 - 20_000))
  })

  test('el goteo diario se reparte sólo por los días que faltan', () => {
    const con = conGotaDiaria(r, -1000, '2026-09-15')
    assert.equal(con.gastos.previsto, -20_000 - 15_000) // del 15 al 30
    assert.equal(con.gastos.real, r.gastos.real)
  })
})

describe('las dos vistas apuntan la nómina al mismo mes', () => {
  // La nómina del 25 de septiembre no paga septiembre: paga octubre. El resumen
  // del mes y la previsión mes a mes tienen que decir lo mismo, o la aplicación
  // se contradice a sí misma en dos pantallas.
  const categorias = new Map([['n', 'nomina'], ['a', 'super'], ['d', 'otros']])

  test('cobrada, cuenta en el mes que abre y no en el que cae', () => {
    const movimientos = [mov('2026-09-25', 280_000, { entidadId: 'n' })]
    const septiembre = resumenDeMes({
      movimientos, categorias, noEsGasto: NO_ES_GASTO, eventos: [], mes: '2026-09', hoy: '2026-09-30',
    })
    const octubre = resumenDeMes({
      movimientos, categorias, noEsGasto: NO_ES_GASTO, eventos: [], mes: '2026-10', hoy: '2026-09-30',
    })
    assert.equal(septiembre.ingresos.real, 0)
    assert.equal(octubre.ingresos.real, 280_000)
  })

  test('prevista, el resumen coincide con la previsión', () => {
    /** @type {import('../src/analisis/bajamar.js').Evento[]} */
    const eventos = [
      { fecha: '2026-10-25', importe: 280_000, nombre: 'Nómina', tipo: 'ingreso', seguro: false },
    ]
    const octubre = resumenDeMes({
      movimientos: [], categorias, noEsGasto: NO_ES_GASTO, eventos, mes: '2026-10', hoy: '2026-10-01',
    })
    const noviembre = resumenDeMes({
      movimientos: [], categorias, noEsGasto: NO_ES_GASTO, eventos, mes: '2026-11', hoy: '2026-10-01',
    })
    assert.equal(octubre.ingresos.previsto, 0)
    assert.equal(noviembre.ingresos.previsto, 280_000)

    // Y la previsión mes a mes, que ya usaba mesContable, dice lo mismo.
    const filas = porMeses(proyectar({
      saldoInicial: 0, desde: '2026-10-01', hasta: '2026-11-30', ritmoPorDia: 0, eventos,
    }))
    assert.equal(filas.find((f) => f.mes === '2026-10')?.ingresos, 0)
    assert.equal(filas.find((f) => f.mes === '2026-11')?.ingresos, 280_000)
  })

  test('un cobro suelto de final de mes se queda donde cae', () => {
    // Sólo se mueve la nómina. Una devolución el 28 es dinero de septiembre.
    const movimientos = [mov('2026-09-28', 10_000, { entidadId: 'd' })]
    const septiembre = resumenDeMes({
      movimientos, categorias, noEsGasto: NO_ES_GASTO, eventos: [], mes: '2026-09', hoy: '2026-09-30',
    })
    assert.equal(septiembre.ingresos.real, 10_000)
  })

  test('un gasto de final de mes nunca se mueve', () => {
    const movimientos = [mov('2026-09-28', -30_000, { entidadId: 'a' })]
    const septiembre = resumenDeMes({
      movimientos, categorias, noEsGasto: NO_ES_GASTO, eventos: [], mes: '2026-09', hoy: '2026-09-30',
    })
    assert.equal(septiembre.gastos.real, -30_000)
  })
})

describe('disponible real', () => {
  /** @type {import('../src/analisis/bajamar.js').Evento[]} */
  const eventos = [
    { fecha: '2026-10-01', importe: 280_000, nombre: 'Nómina', tipo: 'ingreso', seguro: false },
    { fecha: '2026-09-28', importe: -75_000, nombre: 'Alquiler', tipo: 'compromiso', seguro: false },
  ]

  test('el saldo ya incluye lo pasado, así que sólo se suma lo que falta', () => {
    const d = disponibleReal({ saldo: 400_000, eventos, ritmoPorDia: 0, hoy: '2026-09-26', hasta: '2026-09-30' })
    assert.equal(d.porCobrar, 0)
    assert.equal(d.porPagar, -75_000)
    assert.equal(d.total, 325_000)
  })

  test('la reserva se descuenta siempre en negativo', () => {
    const d = disponibleReal({ saldo: 100_000, eventos: [], ritmoPorDia: 0, hoy: '2026-09-26', hasta: '2026-09-30', reserva: 30_000 })
    assert.equal(d.total, 70_000)
    const igual = disponibleReal({ saldo: 100_000, eventos: [], ritmoPorDia: 0, hoy: '2026-09-26', hasta: '2026-09-30', reserva: -30_000 })
    assert.equal(igual.total, 70_000)
  })
})

describe('la previsión mes a mes', () => {
  const proyeccion = proyectar({
    saldoInicial: 300_000,
    desde: '2026-09-26',
    hasta: '2026-11-30',
    ritmoPorDia: -1000,
    eventos: [
      { fecha: '2026-10-01', importe: 280_000, nombre: 'Nómina', tipo: 'ingreso', seguro: false },
      { fecha: '2026-10-05', importe: -75_000, nombre: 'Alquiler', tipo: 'compromiso', seguro: false },
      { fecha: '2026-11-01', importe: 280_000, nombre: 'Nómina', tipo: 'ingreso', seguro: false },
    ],
  })
  const filas = porMeses(proyeccion)

  test('sale un mes por cada mes tocado', () => {
    assert.deepEqual(filas.map((f) => f.mes), ['2026-09', '2026-10', '2026-11'])
  })

  test('cada mes lleva sus ingresos y sus gastos', () => {
    const octubre = filas[1]
    assert.equal(octubre.ingresos, 280_000)
    assert.equal(octubre.gastos, -75_000 + -1000 * 31)
    assert.equal(octubre.ahorro, octubre.ingresos + octubre.gastos)
  })

  test('el suelo de cada mes es suyo, no el del año', () => {
    assert.equal(filas[0].suelo.saldo < 300_000, true)
    for (const fila of filas) assert.equal(fila.suelo.saldo <= fila.saldoFinal + 1, true)
  })

  test('el saldo de partida no cuenta como día vivido', () => {
    // Del 26 al 30 de septiembre hay cuatro días de goteo, no cinco.
    assert.equal(filas[0].gastos, -4000)
  })
})

describe('presupuestos', () => {
  const movimientos = [
    ...['2026-06', '2026-07', '2026-08'].flatMap((m) => [mov(`${m}-10`, -20_000, { entidadId: 'r' })]),
    mov('2026-09-05', -24_000, { entidadId: 'r' }),
    mov('2026-09-05', -50_000, { entidadId: 't' }),
  ]
  const categorias = new Map([['r', 'restaurantes'], ['t', 'traspaso']])

  const lineas = revisarPresupuestos({
    movimientos,
    categorias,
    noEsGasto: NO_ES_GASTO,
    asignado: { restaurantes: 30_000 },
    hoy: '2026-09-20',
  })

  test('el traspaso no genera presupuesto', () => {
    assert.equal(lineas.some((l) => l.id === 'traspaso'), false)
  })

  test('el gastado es el del mes en curso', () => {
    const r = lineas.find((l) => l.id === 'restaurantes')
    assert.equal(r?.gastado, 24_000)
    assert.equal(r?.disponible, 6000)
    assert.equal(r?.porcentaje, 80)
  })

  test('lo habitual sale de meses cerrados, no del actual', () => {
    const r = lineas.find((l) => l.id === 'restaurantes')
    assert.equal(r?.habitual, 20_000)
    assert.equal(Math.round((r?.desvio ?? 0) * 100), 20)
    assert.equal(r?.propuesto, false)
  })

  test('sin presupuesto fijado se propone lo habitual', () => {
    const [linea] = revisarPresupuestos({
      movimientos,
      categorias,
      noEsGasto: NO_ES_GASTO,
      asignado: {},
      hoy: '2026-09-20',
    })
    assert.equal(linea.propuesto, true)
    assert.equal(linea.presupuesto, 20_000)
  })
})

describe('capacidad de ahorro', () => {
  test('los anuales no se restan dos veces', () => {
    // Fijos 1.150 € de los que 250 € son la parte proporcional de los anuales.
    const r = capacidadDeAhorro({ ingresos: 280_000, fijos: -115_000, ordinario: -50_000, reserva: -25_000 })
    assert.equal(r.capacidad, 280_000 - 115_000 - 50_000)
  })

  test('acepta signos en cualquier sentido', () => {
    const a = capacidadDeAhorro({ ingresos: 100_000, fijos: -20_000, ordinario: -10_000, reserva: 0 })
    const b = capacidadDeAhorro({ ingresos: 100_000, fijos: 20_000, ordinario: 10_000, reserva: 0 })
    assert.equal(a.capacidad, b.capacidad)
  })
})

describe('objetivos', () => {
  test('al ritmo puesto, la fecha de llegada', () => {
    const p = progresoDe(
      { id: '1', nombre: 'Camper', meta: 300_000, ahorrado: 120_000, aportacion: 30_000 },
      '2026-09-26',
    )
    assert.equal(p.faltan, 180_000)
    assert.equal(p.porcentaje, 40)
    assert.equal(p.meses, 6)
    assert.equal(p.fechaLlegada, '2027-03-26')
  })

  test('sin aportación no hay fecha, y se dice', () => {
    const p = progresoDe({ id: '1', nombre: 'X', meta: 100_000, ahorrado: 0, aportacion: 0 }, '2026-09-26')
    assert.equal(p.meses, Infinity)
    assert.equal(p.alcanzable, false)
    assert.equal(p.aportacionNecesaria, 100_000)
  })

  test('con fecha marcada dice cuánto haría falta', () => {
    const p = progresoDe(
      { id: '1', nombre: 'X', meta: 120_000, ahorrado: 0, aportacion: 10_000, fechaMeta: '2026-12-26' },
      '2026-09-26',
    )
    assert.equal(p.aportacionNecesaria, 40_000)
    assert.equal(p.alcanzable, false)
  })

  test('cumplido es cumplido', () => {
    const p = progresoDe({ id: '1', nombre: 'X', meta: 100_000, ahorrado: 100_000, aportacion: 0 }, '2026-09-26')
    assert.equal(p.porcentaje, 100)
    assert.equal(p.meses, 0)
  })
})

describe('patrimonio', () => {
  /** @type {import('../src/analisis/patrimonio.js').Apunte[]} */
  const apuntes = [
    { id: '1', nombre: 'Furgoneta', grupo: 'bienes', valor: 1_200_000, fecha: '2026-01-01' },
    { id: '2', nombre: 'Furgoneta', grupo: 'bienes', valor: 1_000_000, fecha: '2026-06-01' },
    { id: '3', nombre: 'Fondo', grupo: 'inversiones', valor: 500_000, fecha: '2026-06-01' },
    { id: '4', nombre: 'Préstamo', grupo: 'deudas', valor: 300_000, fecha: '2026-06-01' },
  ]

  test('cada partida vale lo que dice su foto más reciente', () => {
    assert.equal(vigentes(apuntes).length, 3)
    assert.equal(balance(apuntes).porGrupo.find((g) => g.grupo === 'bienes')?.total, 1_000_000)
  })

  test('mirar al pasado devuelve el valor de entonces', () => {
    assert.equal(balance(apuntes, '2026-03-01').neto, 1_200_000)
  })

  test('las deudas restan aunque se escriban en positivo', () => {
    const b = balance(apuntes)
    assert.equal(b.activos, 1_500_000)
    assert.equal(b.pasivos, -300_000)
    assert.equal(b.neto, 1_200_000)
  })

  test('la evolución sólo tiene puntos donde hay datos', () => {
    const serie = evolucion(apuntes)
    assert.deepEqual(serie.map((p) => p.fecha), ['2026-01-01', '2026-06-01'])
  })

  test('la variación compara contra el punto anterior al corte', () => {
    const v = variacion(evolucion(apuntes), 6)
    assert.equal(v?.absoluta, 0)
    assert.equal(variacion([{ fecha: '2026-01-01', neto: 100 }], 6), null)
  })
})

describe('avisos', () => {
  const base = {
    fijos: [],
    ingresos: [],
    movimientos: [],
    nombres: new Map(),
    presupuestos: [],
    colchon: 100_000,
    hoy: '2026-09-26',
  }

  /** @param {number} suelo */
  function conSuelo(suelo) {
    return proyectar({
      saldoInicial: suelo,
      desde: '2026-09-26',
      hasta: '2026-09-30',
      eventos: [],
      ritmoPorDia: 0,
    })
  }

  test('el descubierto es lo más grave', () => {
    const [aviso] = revisar({ ...base, proyeccion: conSuelo(-50_000) })
    assert.equal(aviso.nivel, 'alto')
    assert.equal(aviso.clase, 'suelo')
  })

  test('por debajo del colchón avisa, pero más bajo', () => {
    const [aviso] = revisar({ ...base, proyeccion: conSuelo(50_000) })
    assert.equal(aviso.nivel, 'medio')
  })

  test('con margen de sobra no dice nada', () => {
    assert.deepEqual(revisar({ ...base, proyeccion: conSuelo(500_000) }), [])
  })

  test('un recibo anual gordo se anuncia con antelación', () => {
    const fijos = describirFijos(
      [compromiso({ periodicidad: 'anual', importeEsperado: -62_400, proximaPrevista: '2026-10-08', nombre: 'Seguro' })],
      [],
      new Map(),
    )
    const avisos = revisar({ ...base, proyeccion: conSuelo(500_000), fijos })
    assert.equal(avisos.length, 1)
    assert.match(avisos[0].titulo, /Seguro/)
    assert.equal(avisos[0].clase, 'anual')
  })

  test('el mismo cargo dos veces en tres días se pregunta, no se afirma', () => {
    const avisos = revisar({
      ...base,
      proyeccion: conSuelo(500_000),
      nombres: new Map([['e', 'Un bar']]),
      movimientos: [mov('2026-09-20', -8000), mov('2026-09-21', -8000)],
    })
    assert.equal(avisos.length, 1)
    assert.match(avisos[0].titulo, /^Posible/)
  })

  test('dos cargos distintos no son duplicado', () => {
    const avisos = revisar({
      ...base,
      proyeccion: conSuelo(500_000),
      movimientos: [mov('2026-09-20', -8000), mov('2026-09-21', -8001)],
    })
    assert.deepEqual(avisos, [])
  })

  test('una clase silenciada no aparece', () => {
    const avisos = revisar({ ...base, proyeccion: conSuelo(-50_000), silenciadas: new Set(['suelo']) })
    assert.deepEqual(avisos, [])
  })
})

describe('un cobro con fecha de hoy', () => {
  test('baja el saldo aunque sea el primer día de la proyección', () => {
    const p = proyectar({
      saldoInicial: 100000,
      desde: '2026-09-27',
      hasta: '2026-09-30',
      eventos: [{ fecha: '2026-09-27', nombre: 'MAPFRE', importe: -58237 }],
      ritmoPorDia: 0,
    })
    // El saldo del extracto no lo lleva descontado: aún no ha pasado por el
    // banco. Si no se aplica, el recibo sale en la lista y no lo paga nadie.
    assert.equal(p.suelo.saldo, 41763)
    assert.equal(p.saldoFinal, 41763)
    assert.equal(p.curva[0].saldo, 41763)
  })
})

describe('el mes empieza con la nómina', () => {
  /**
   * @param {string} reciboId
   * @param {string} nombre
   * @param {number} importe
   * @param {'mensual'|'bimestral'|'trimestral'|'semestral'|'anual'} periodicidad
   * @param {string} proximaPrevista
   * @param {string} categoria
   */
  const fijo = (reciboId, nombre, importe, periodicidad, proximaPrevista, categoria) => ({
    entidadId: reciboId.split('#')[0],
    reciboId,
    nombre,
    periodicidad,
    importeEsperado: importe,
    mensualEquivalente: Math.round(importe / MESES_DE[periodicidad]),
    variacion: 0,
    proximaPrevista,
    categoria,
    estable: true,
    estado: /** @type {const} */ ('activo'),
  })

  const fijos = [
    fijo('fondo', 'MyInvestor', -50000, 'mensual', '2026-10-28', 'traspaso'),
    fijo('prestamo', 'Furgoneta', -46800, 'mensual', '2026-10-10', 'traspaso'),
    fijo('fibra', 'O2 Fibra', -5300, 'mensual', '2026-10-01', 'telecom'),
    fijo('ibi', 'Ajuntament', -45987, 'anual', '2026-10-01', 'impuestos'),
    fijo('seguro', 'MAPFRE', -58237, 'anual', '2026-09-27', 'seguros'),
  ]

  test('cobrar el 25 te pone ya en el mes siguiente', () => {
    assert.equal(mesEnCurso('2026-09-27'), '2026-10')
    assert.equal(mesEnCurso('2026-09-19'), '2026-09')
    assert.equal(mesEnCurso('2026-12-25'), '2027-01')
  })

  test('la cascada resta de la nómina en orden y cuadra', () => {
    const c = cascadaDelMes({ mes: '2026-10', fijos, ingreso: 282249, diaADia: -121757 })
    assert.equal(c.ingreso, 282249)
    // El fondo y el préstamo salen por el mismo sitio: los dos son traspaso.
    assert.equal(c.sumaInversiones, -96800)
    assert.equal(c.sumaFijos, -5300)
    // MAPFRE es de septiembre, aunque se pague tres días antes de cobrar.
    assert.deepEqual(c.toca.map((t) => t.nombre), ['Ajuntament'])
    assert.equal(c.sumaToca, -45987)
    assert.equal(c.resultado, 282249 - 96800 - 5300 - 121757 - 45987)
  })

  test('el préstamo se puede sacar de las inversiones', () => {
    const c = cascadaDelMes({
      mes: '2026-10', fijos, ingreso: 282249, diaADia: -121757,
      inversiones: { prestamo: false },
    })
    assert.deepEqual(c.inversiones.map((i) => i.nombre), ['MyInvestor'])
    assert.equal(c.sumaInversiones, -50000)
    assert.equal(c.sumaFijos, -46800 - 5300)
    // Cambiar de columna no cambia lo que queda a fin de mes.
    assert.equal(c.resultado, 282249 - 96800 - 5300 - 121757 - 45987)
  })

  test('lo que puedes saltarte se mide aparte, sin salir de la cuenta', () => {
    const conSuelto = fijos.map((f) => (f.reciboId === 'fondo' ? { ...f, aplazable: true } : f))
    const c = cascadaDelMes({ mes: '2026-10', fijos: conSuelto, ingreso: 282249, diaADia: -121757 })
    assert.equal(c.aplazable, -50000)
    // Saltárselo es una posibilidad, no un hecho: el resultado no lo descuenta.
    assert.equal(c.sumaInversiones, -96800)
    assert.equal(c.resultado, 282249 - 96800 - 5300 - 121757 - 45987)
  })

  test('un mes sin recibos gordos lo dice', () => {
    const c = cascadaDelMes({ mes: '2026-11', fijos, ingreso: 282249, diaADia: -121757 })
    assert.deepEqual(c.toca, [])
    assert.equal(c.sumaToca, 0)
  })

  test('la nómina de fin de mes cuenta en el mes que abre', () => {
    const proyeccion = proyectar({
      saldoInicial: 0,
      desde: '2026-09-01',
      hasta: '2026-10-31',
      ritmoPorDia: 0,
      eventos: [
        { fecha: '2026-09-25', importe: 282249, nombre: 'Nómina', tipo: 'ingreso', seguro: false },
        { fecha: '2026-09-27', importe: -58237, nombre: 'MAPFRE', tipo: 'compromiso', seguro: false },
      ],
    })
    const meses = porMeses(proyeccion)
    const sept = meses.find((m) => m.mes === '2026-09')
    const oct = meses.find((m) => m.mes === '2026-10')
    assert.equal(sept?.ingresos, 0)
    assert.equal(oct?.ingresos, 282249)
    // El dinero no se mueve: el saldo del 25 sigue subiendo ese día.
    assert.equal(proyeccion.curva.find((p) => p.fecha === '2026-09-25')?.saldo, 282249)
  })
})

test('la categoría del recibo manda sobre la del cobrador', () => {
  // Dos suscripciones cobradas por el mismo PayPal: la regla del cobrador no
  // puede distinguirlas, la del recibo sí.
  const cobros = []
  for (const mes of ['05', '06', '07', '08', '09']) {
    cobros.push(
      { id: `d${mes}`, fecha: `2026-${mes}-24`, nombre: 'PayPal', entidadId: 'paypal', importe: -699, saldo: 0, conceptoRaw: 'PAYPAL DISNEY' },
      { id: `h${mes}`, fecha: `2026-${mes}-03`, nombre: 'PayPal', entidadId: 'paypal', importe: -549, saldo: 0, conceptoRaw: 'PAYPAL HBO' },
    )
  }
  const compromisos = [
    { entidadId: 'paypal', reciboId: 'paypal#7', nombre: 'PayPal', periodicidad: /** @type {const} */ ('mensual'), importeEsperado: -699, proximaPrevista: '2026-10-24', cobros: ['d09'], estado: /** @type {const} */ ('activo') },
    { entidadId: 'paypal', reciboId: 'paypal#5', nombre: 'PayPal', periodicidad: /** @type {const} */ ('mensual'), importeEsperado: -549, proximaPrevista: '2026-10-03', cobros: ['h09'], estado: /** @type {const} */ ('activo') },
  ]
  const categorias = new Map([['paypal', 'compras'], ['paypal#7', 'suscripciones']])
  const descritos = describirFijos(compromisos, cobros, categorias)
  assert.equal(descritos.find((f) => f.reciboId === 'paypal#7')?.categoria, 'suscripciones')
  assert.equal(descritos.find((f) => f.reciboId === 'paypal#5')?.categoria, 'compras')
})

describe('saltarse un mes no es darse de baja', () => {
  const fijo = {
    entidadId: 'myinvestor',
    reciboId: 'myinvestor#500',
    nombre: 'MyInvestor',
    periodicidad: /** @type {const} */ ('mensual'),
    importeEsperado: -50000,
    mensualEquivalente: -50000,
    variacion: 0,
    proximaPrevista: '2026-10-28',
    categoria: 'traspaso',
    estable: true,
    estado: /** @type {const} */ ('activo'),
    aplazable: true,
  }

  test('lo saltado no suma, pero sigue a la vista para poder deshacerlo', () => {
    const normal = cascadaDelMes({ mes: '2026-10', fijos: [fijo], ingreso: 282249, diaADia: 0 })
    assert.equal(normal.sumaInversiones + normal.sumaFijos, -50000)

    const saltada = cascadaDelMes({
      mes: '2026-10', fijos: [fijo], ingreso: 282249, diaADia: 0,
      saltados: { 'myinvestor#500|2026-10': true },
    })
    assert.equal(saltada.sumaInversiones + saltada.sumaFijos, 0)
    // Si desapareciera de la lista se olvidaria que se salto.
    const todos = [...saltada.fijos, ...saltada.inversiones]
    assert.equal(todos.length, 1)
    assert.equal(todos[0].saltado, true)
    assert.equal(saltada.resultado, 282249)
  })

  test('lo ya saltado no se vuelve a ofrecer como margen', () => {
    // El pie de la cascada dice «saltarte lo que puedes saltarte te dejaría X».
    // Si lo saltado siguiera contando ahí, ofrecería por segunda vez los mismos
    // 500 € que ya has decidido no invertir, y la cifra saldría inflada.
    const normal = cascadaDelMes({ mes: '2026-10', fijos: [fijo], ingreso: 282249, diaADia: 0 })
    assert.equal(normal.aplazable, -50000)

    const saltada = cascadaDelMes({
      mes: '2026-10', fijos: [fijo], ingreso: 282249, diaADia: 0,
      saltados: { 'myinvestor#500|2026-10': true },
    })
    assert.equal(saltada.aplazable, 0)
    // Y entonces no queda nada que ofrecer: ya está descontado del resultado.
    assert.equal(saltada.resultado - saltada.aplazable, saltada.resultado)
  })

  test('saltarse octubre no salta noviembre', () => {
    const noviembre = cascadaDelMes({
      mes: '2026-11', fijos: [{ ...fijo, proximaPrevista: '2026-11-28' }],
      ingreso: 282249, diaADia: 0,
      saltados: { 'myinvestor#500|2026-10': true },
    })
    assert.equal(noviembre.sumaInversiones + noviembre.sumaFijos, -50000)
  })
})

describe('lo que aplazas vuelve en tres cuotas', () => {
  /** @param {string} fecha @param {number} importe @param {string} concepto */
  const abono = (fecha, importe, concepto) => ({
    id: `c:${fecha}:${importe}`, fecha, fechaValor: fecha, conceptoRaw: concepto,
    entidadId: null, importe, saldo: null, origen: 'cuenta',
    localidad: null, fraccionado: true, excepcional: false,
  })

  /** @param {string} fecha @param {number} importe @param {string} concepto */
  const cargo = (fecha, importe, concepto) => ({
    id: `t:${fecha}:${importe}`, fecha, fechaValor: fecha, conceptoRaw: concepto,
    entidadId: null, importe: -importe, saldo: null, origen: 'tarjeta',
    localidad: null, fraccionado: true, excepcional: false,
  })

  test('tres cuotas a fin de mes, y la última recoge el redondeo', () => {
    const cuotas = cuotasPendientes([abono('2026-07-01', 33100, 'FRACCIONAMIENTO IMPUESTOS AJ. GAVA')], '2026-06-30')
    assert.deepEqual(cuotas.map((c) => c.fecha), ['2026-07-31', '2026-08-31', '2026-09-30'])
    assert.deepEqual(cuotas.map((c) => c.importe), [-11033, -11033, -11034])
    assert.equal(cuotas.reduce((t, c) => t + c.importe, 0), -33100)
    assert.equal(cuotas[0].nombre, 'IMPUESTOS AJ. GAVA')
  })

  test('lo ya cobrado no se proyecta otra vez', () => {
    const cuotas = cuotasPendientes([abono('2026-09-23', 46800, 'FRACCIONAMIENTO TRANSFERENCIA A MyInvestor')], '2026-09-30')
    assert.deepEqual(cuotas.map((c) => c.fecha), ['2026-10-31', '2026-11-30'])
    assert.equal(cuotas[0].plazo, 2)
    assert.equal(cuotas[0].nombre, 'MyInvestor')
  })

  test('la cuota sale del extracto, con sus intereses dentro', () => {
    const c = cuotasPendientes([
      abono('2026-09-23', 46800, 'FRACCIONAMIENTO TRANSFERENCIA A MyInvestor'),
      cargo('2026-09-22', 16132, 'TRANSFERENCIA A MyInvesto'),
    ], '2026-09-30')
    // Dividir 468 entre tres daria 156,00: el banco cobra 161,32.
    assert.deepEqual(c.map((x) => x.importe), [-16132, -16132])
    assert.equal(c[0].estimada, false)
  })

  test('sin extracto se divide entre tres, y se dice que es una estimacion', () => {
    const c = cuotasPendientes([
      abono('2026-09-23', 46800, 'FRACCIONAMIENTO TRANSFERENCIA A MyInvestor'),
    ], '2026-09-30')
    assert.deepEqual(c.map((x) => x.importe), [-15600, -15600])
    assert.equal(c[0].estimada, true)
  })

  test('tres recibos del mismo dia se distinguen por el importe', () => {
    const cuotas = cuotasPendientes([
      abono('2026-07-01', 11514, 'FRACCIONAMIENTO IMPUESTOS AJ. GAVA'),
      abono('2026-07-02', 11050, 'FRACCIONAMIENTO IMPUESTOS AJ. GAVA'),
      abono('2026-07-03', 33071, 'FRACCIONAMIENTO IMPUESTOS AJ. GAVA'),
      cargo('2026-07-01', 3838, 'IMPUESTOS AJ. GAVA'),
      cargo('2026-07-02', 3683, 'IMPUESTOS AJ. GAVA'),
      cargo('2026-07-03', 11024, 'IMPUESTOS AJ. GAVA'),
    ], '2026-08-31')
    assert.deepEqual(cuotas.map((x) => x.importe).sort((a, b) => a - b), [-11024, -3838, -3683])
  })

  test('un cargo normal no es un aplazamiento', () => {
    assert.deepEqual(cuotasPendientes([abono('2026-07-01', -5000, 'COMPRA TARJ. CONDIS')], '2026-06-30'), [])
  })

  test('el apunte de la tarjeta no cuenta: ahí sólo está la cuota del mes', () => {
    const enTarjeta = { ...abono('2026-07-01', 11000, 'FRACCIONAMIENTO IMPUESTOS'), origen: 'tarjeta' }
    assert.deepEqual(cuotasPendientes([enTarjeta], '2026-06-30'), [])
  })
})
