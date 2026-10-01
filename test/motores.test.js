// @ts-check
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { describirFijos, estructura, MESES_DE } from '../src/analisis/fijos.js'
import { cascadaDelPeriodo } from '../src/analisis/cascada.js'
import { periodosEntre } from '../src/analisis/periodos.js'
import { cuotasPendientes } from '../src/analisis/fraccionados.js'
import { cierresPorDia } from '../src/analisis/mensual.js'
import { disponibleReal } from '../src/analisis/mes.js'
import { revisarPresupuestos } from '../src/analisis/presupuestos.js'
import { capacidadDeAhorro } from '../src/analisis/objetivos.js'
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

describe('presupuestos', () => {
  /**
   * Cuatro periodos cerrados con 200 € de restaurantes y uno en curso con 240.
   * Los periodos vienen ya detallados porque la costumbre se mide sobre ellos:
   * medirla sobre meses naturales daría una referencia que no se parece a
   * nada de lo que se enseña.
   * @param {string} id
   * @param {'cerrado' | 'enCurso'} estado
   * @param {number} importe
   */
  const periodo = (id, estado, importe) => ({
    id, estado, completo: true,
    movimientos: [
      { ...mov(`${id}-10`, -importe, { entidadId: 'r' }), categoria: 'restaurantes' },
      { ...mov(`${id}-11`, -50_000, { entidadId: 't' }), categoria: 'traspaso' },
    ],
  })
  const periodos = [
    periodo('2026-06', 'cerrado', 20_000),
    periodo('2026-07', 'cerrado', 20_000),
    periodo('2026-08', 'cerrado', 20_000),
    periodo('2026-09', 'enCurso', 24_000),
  ]
  const enCurso = periodos[periodos.length - 1]

  const lineas = revisarPresupuestos({
    periodos,
    periodo: enCurso,
    noEsGasto: NO_ES_GASTO,
    asignado: { restaurantes: 30_000 },
  })

  test('el traspaso no genera presupuesto', () => {
    assert.equal(lineas.some((l) => l.id === 'traspaso'), false)
  })

  test('el gastado es el del periodo que se mira', () => {
    const r = lineas.find((l) => l.id === 'restaurantes')
    assert.equal(r?.gastado, 24_000)
    assert.equal(r?.disponible, 6000)
    assert.equal(r?.porcentaje, 80)
  })

  test('lo habitual sale de periodos cerrados, no del que corre', () => {
    const r = lineas.find((l) => l.id === 'restaurantes')
    assert.equal(r?.habitual, 20_000)
    assert.equal(Math.round((r?.desvio ?? 0) * 100), 20)
    assert.equal(r?.propuesto, false)
  })

  test('sin repartir se propone lo habitual', () => {
    const [linea] = revisarPresupuestos({
      periodos, periodo: enCurso, noEsGasto: NO_ES_GASTO, asignado: {},
    })
    assert.equal(linea.propuesto, true)
    assert.equal(linea.presupuesto, 20_000)
  })

  test('un periodo incompleto no cuenta para medir la costumbre', () => {
    // El primero del extracto está cortado: diría que ese mes gastaste la mitad.
    const conCortado = [{ ...periodos[0], completo: false }, ...periodos.slice(1)]
    const [linea] = revisarPresupuestos({
      periodos: conCortado, periodo: enCurso, noEsGasto: NO_ES_GASTO, asignado: {},
    })
    // Quedan dos cerrados completos, que siguen bastando para una mediana.
    assert.equal(linea.habitual, 20_000)
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
    fijo('fondo', 'MyInvestor', -50000, 'mensual', '2026-10-20', 'traspaso'),
    fijo('prestamo', 'Furgoneta', -46800, 'mensual', '2026-10-10', 'traspaso'),
    fijo('fibra', 'O2 Fibra', -5300, 'mensual', '2026-10-01', 'telecom'),
    fijo('ibi', 'Ajuntament', -45987, 'anual', '2026-10-01', 'impuestos'),
    fijo('seguro', 'MAPFRE', -58237, 'anual', '2026-09-27', 'seguros'),
  ]

  // Octubre es el periodo que abre la nómina del 25 de septiembre.
  const [, octubre] = periodosEntre({
    cortes: ['2026-08-25', '2026-09-25', '2026-10-25'],
    desde: '2026-08-25',
    hasta: '2026-11-30',
  })

  test('octubre empieza el día que entra la nómina', () => {
    assert.equal(octubre.id, '2026-10')
    assert.equal(octubre.desde, '2026-09-25')
    assert.equal(octubre.hasta, '2026-10-24')
  })

  test('la cascada resta de la nómina en orden y cuadra', () => {
    const c = cascadaDelPeriodo({ periodo: octubre, fijos, conFecha: deOctubre(), ingreso: 282249, diaADia: -121757 })
    assert.equal(c.ingreso, 282249)
    // El fondo y el préstamo salen por el mismo sitio: los dos son traspaso.
    assert.equal(c.sumaInversiones, -96800)
    assert.equal(c.sumaFijos, -5300)
    // MAPFRE se paga el 27 de septiembre, dos días después de cobrar: lo paga
    // esta nómina, así que es de octubre. Con meses naturales caía en
    // septiembre y el recibo aparecía en el mes que no lo pagaba.
    assert.deepEqual(c.toca.map((x) => x.nombre).sort(), ['Ajuntament', 'MAPFRE'])
    assert.equal(c.sumaToca, -45987 - 58237)
    assert.equal(c.resultado, 282249 - 96800 - 5300 - 121757 - 45987 - 58237)
  })

  test('el préstamo se puede sacar de las inversiones', () => {
    const c = cascadaDelPeriodo({
      periodo: octubre, fijos, conFecha: deOctubre(), ingreso: 282249, diaADia: -121757,
      inversiones: { prestamo: false },
    })
    assert.deepEqual(c.inversiones.map((i) => i.nombre), ['MyInvestor'])
    assert.equal(c.sumaInversiones, -50000)
    assert.equal(c.sumaFijos, -46800 - 5300)
    // Cambiar de columna no cambia lo que queda a fin de mes.
    assert.equal(c.resultado, 282249 - 96800 - 5300 - 121757 - 45987 - 58237)
  })

  test('lo que puedes saltarte se mide aparte, sin salir de la cuenta', () => {
    const conSuelto = fijos.map((f) => (f.reciboId === 'fondo' ? { ...f, aplazable: true } : f))
    const c = cascadaDelPeriodo({
      periodo: octubre, fijos: conSuelto, ingreso: 282249, diaADia: -121757,
      conFecha: deOctubre().map((a) => (a.reciboId === 'fondo' ? { ...a, aplazable: true } : a)),
    })
    assert.equal(c.aplazable, -50000)
    // Saltárselo es una posibilidad, no un hecho: el resultado no lo descuenta.
    assert.equal(c.sumaInversiones, -96800)
    assert.equal(c.resultado, 282249 - 96800 - 5300 - 121757 - 45987 - 58237)
  })

  test('un mes sin recibos gordos lo dice', () => {
    const [, , noviembre] = periodosEntre({
      cortes: ['2026-08-25', '2026-09-25', '2026-10-25', '2026-11-25'],
      desde: '2026-08-25', hasta: '2026-12-31',
    })
    const c = cascadaDelPeriodo({
      periodo: noviembre, fijos, ingreso: 282249, diaADia: -121757,
      conFecha: [apunte('2026-11-01', -5300, 'fibra')],
    })
    assert.deepEqual(c.toca, [])
    assert.equal(c.sumaToca, 0)
  })

  test('un recibo de dos días después de cobrar lo paga esa nómina', () => {
    // Antes esto necesitaba un desplazamiento: el mes era del 1 al 30 y había
    // que apuntar el cobro del 25 al mes siguiente a mano. Ahora el periodo
    // empieza el 25 y el recibo del 27 cae dentro sin que nadie lo mueva.
    const [, octubreSolo] = periodosEntre({
      cortes: ['2026-08-25', '2026-09-25', '2026-10-25'],
      desde: '2026-08-25', hasta: '2026-11-30',
    })
    const seguro = fijo('mapfre', 'MAPFRE', -58237, 'anual', '2026-09-27', 'seguros')
    const c = cascadaDelPeriodo({
      periodo: octubreSolo, fijos: [seguro], ingreso: 282249, diaADia: 0,
      conFecha: [apunte('2026-09-27', -58237, 'mapfre')],
    })
    assert.deepEqual(c.toca.map((x) => x.fecha), ['2026-09-27'])
    assert.equal(c.resultado, 282249 - 58237)
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
    proximaPrevista: '2026-10-20',
    categoria: 'traspaso',
    estable: true,
    estado: /** @type {const} */ ('activo'),
    aplazable: true,
  }

  const [, octubre] = periodosEntre({
    cortes: ['2026-08-25', '2026-09-25', '2026-10-25'],
    desde: '2026-08-25', hasta: '2026-11-30',
  })
  const [, , noviembre] = periodosEntre({
    cortes: ['2026-08-25', '2026-09-25', '2026-10-25', '2026-11-25'],
    desde: '2026-08-25', hasta: '2026-12-31',
  })

  test('lo saltado no suma, pero sigue a la vista para poder deshacerlo', () => {
    const normal = cascadaDelPeriodo({
      periodo: octubre, fijos: [fijo], ingreso: 282249, diaADia: 0,
      conFecha: [{ ...apunte('2026-10-20', -50000, 'myinvestor#500'), aplazable: true }],
    })
    assert.equal(normal.sumaInversiones + normal.sumaFijos, -50000)

    const saltada = cascadaDelPeriodo({
      periodo: octubre, fijos: [fijo], ingreso: 282249, diaADia: 0,
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
    const normal = cascadaDelPeriodo({
      periodo: octubre, fijos: [fijo], ingreso: 282249, diaADia: 0,
      conFecha: [{ ...apunte('2026-10-20', -50000, 'myinvestor#500'), aplazable: true }],
    })
    assert.equal(normal.aplazable, -50000)

    const saltada = cascadaDelPeriodo({
      periodo: octubre, fijos: [fijo], ingreso: 282249, diaADia: 0,
      saltados: { 'myinvestor#500|2026-10': true },
    })
    assert.equal(saltada.aplazable, 0)
    // Y entonces no queda nada que ofrecer: ya está descontado del resultado.
    assert.equal(saltada.resultado - saltada.aplazable, saltada.resultado)
  })

  test('saltarse octubre no salta noviembre', () => {
    const siguiente = cascadaDelPeriodo({
      periodo: noviembre, fijos: [{ ...fijo, proximaPrevista: '2026-11-20' }],
      ingreso: 282249, diaADia: 0,
      conFecha: [apunte('2026-11-20', -50000, 'myinvestor#500')],
      saltados: { 'myinvestor#500|2026-10': true },
    })
    assert.equal(siguiente.sumaInversiones + siguiente.sumaFijos, -50000)
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

  test('tres cuotas a fin de mes, desde el mes siguiente, y la última recoge el redondeo', () => {
    // Lo del 1 de julio seguía en la foto del 30 de septiembre: su última cuota es la de octubre.
    const cuotas = cuotasPendientes([abono('2026-07-01', 33100, 'FRACCIONAMIENTO IMPUESTOS AJ. GAVA')], '2026-06-30')
    assert.deepEqual(cuotas.map((c) => c.fecha), ['2026-08-31', '2026-09-30', '2026-10-31'])
    assert.deepEqual(cuotas.map((c) => c.importe), [-11033, -11033, -11034])
    assert.equal(cuotas.reduce((t, c) => t + c.importe, 0), -33100)
    assert.equal(cuotas[0].nombre, 'IMPUESTOS AJ. GAVA')
  })

  test('lo ya cobrado no se proyecta otra vez', () => {
    const cuotas = cuotasPendientes([abono('2026-07-01', 33100, 'FRACCIONAMIENTO IMPUESTOS AJ. GAVA')], '2026-09-30')
    assert.deepEqual(cuotas.map((c) => c.fecha), ['2026-10-31'])
    assert.equal(cuotas[0].plazo, 3)
  })

  test('lo fraccionado el 23 no entra en la liquidación del 30', () => {
    const cuotas = cuotasPendientes([abono('2026-09-23', 46800, 'FRACCIONAMIENTO TRANSFERENCIA A MyInvestor')], '2026-09-30')
    assert.deepEqual(cuotas.map((c) => c.fecha), ['2026-10-31', '2026-11-30', '2026-12-31'])
    assert.equal(cuotas[0].plazo, 1)
    assert.equal(cuotas[0].nombre, 'MyInvestor')
  })

  test('la cuota sale del extracto, con sus intereses dentro', () => {
    const c = cuotasPendientes([
      abono('2026-09-23', 46800, 'FRACCIONAMIENTO TRANSFERENCIA A MyInvestor'),
      cargo('2026-09-22', 16132, 'TRANSFERENCIA A MyInvesto'),
    ], '2026-09-30')
    // Dividir 468 entre tres daria 156,00: el banco cobra 161,32.
    assert.deepEqual(c.map((x) => x.importe), [-16132, -16132, -16132])
    assert.equal(c[0].nombre, 'MyInvestor', 'el nombre sale del abono, que no recorta')
    assert.equal(c[0].estimada, false)
  })

  test('sin extracto se divide entre tres, y se dice que es una estimacion', () => {
    const c = cuotasPendientes([
      abono('2026-09-23', 46800, 'FRACCIONAMIENTO TRANSFERENCIA A MyInvestor'),
    ], '2026-09-30')
    assert.deepEqual(c.map((x) => x.importe), [-15600, -15600, -15600])
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
    const deSeptiembre = cuotas.filter((x) => x.fecha === '2026-09-30')
    assert.deepEqual(deSeptiembre.map((x) => x.importe).sort((a, b) => a - b), [-11024, -3838, -3683])
  })

  test('lo fraccionado dentro de la tarjeta, sin abono en la cuenta, también vuelve', () => {
    // Siete compras de junio de la foto del 26: sin ellas el cobro del 30 salía 356,51 € corto.
    const enFoto = { ...cargo('2026-06-10', 13202, 'LULUKABARAKA, SL'), foto: '2026-09-26 x' }
    const c = cuotasPendientes([enFoto], '2026-08-31')
    assert.deepEqual(c.map((x) => [x.fecha, x.importe]), [['2026-09-30', -13202]])
  })

  test('un abono que la foto posterior ya no trae está pagado', () => {
    const c = cuotasPendientes([
      abono('2026-06-22', 7000, 'FRACCIONAMIENTO COMPRA TARJ. DOGGY DOG-GAV'),
      { ...cargo('2026-09-22', 16132, 'TRANSFERENCIA A MyInvesto'), foto: '2026-09-30 x' },
    ], '2026-06-30')
    assert.ok(!c.some((x) => /DOGGY/.test(x.nombre)), 'Doggy Dog ya no sale en la foto del 30')
  })

  test('un cargo normal no es un aplazamiento', () => {
    assert.deepEqual(cuotasPendientes([abono('2026-07-01', -5000, 'COMPRA TARJ. CONDIS')], '2026-06-30'), [])
  })

  test('el apunte de la tarjeta no cuenta: ahí sólo está la cuota del mes', () => {
    const enTarjeta = { ...abono('2026-07-01', 11000, 'FRACCIONAMIENTO IMPUESTOS'), origen: 'tarjeta' }
    assert.deepEqual(cuotasPendientes([enTarjeta], '2026-06-30'), [])
  })
})

describe('con qué cerró cada día', () => {
  /** @param {string} fecha @param {number} importe @param {number} saldo */
  const apunte = (fecha, importe, saldo) => ({
    id: `${fecha}-${importe}-${saldo}`, fecha, importe, saldo, origen: 'cuenta',
    concepto: 'x', conceptoRaw: 'x', entidadId: 'x', categoria: 'otros',
  })

  test('dentro de un día manda la cadena de saldos, no el orden del fichero', () => {
    // El extracto los trae al revés: el de -39,99 aparece antes que el de
    // -134,95, pero es el segundo quien deja el saldo del que parte el primero.
    const cierres = cierresPorDia([
      apunte('2026-08-26', -3999, 74760),
      apunte('2026-08-26', -13495, 78759),
    ])
    assert.equal(cierres.get('2026-08-26'), 74760)
  })

  test('un cargo y su devolución el mismo día no descuadran el cierre', () => {
    // La comisión de 60 € que el banco cobra y devuelve el mismo día deja dos
    // apuntes con idéntico saldo: la cadena se muerde la cola y hay que
    // resolverla sumando sobre lo que había al abrir el día.
    const cierres = cierresPorDia([
      apunte('2026-09-23', -1000, 114267),
      apunte('2026-09-24', 6000, 104866),
      apunte('2026-09-24', -8702, 104866),
      apunte('2026-09-24', -699, 113568),
      apunte('2026-09-24', -6000, 98866),
    ])
    assert.equal(cierres.get('2026-09-23'), 114267)
    assert.equal(cierres.get('2026-09-24'), 104866)
  })

  test('un día sin saldos no rompe la cadena', () => {
    const cierres = cierresPorDia([
      apunte('2026-09-01', -100, 50000),
      { ...apunte('2026-09-02', -100, 0), saldo: null },
      apunte('2026-09-03', -100, 49800),
    ])
    assert.equal(cierres.get('2026-09-01'), 50000)
    assert.equal(cierres.has('2026-09-02'), false)
    assert.equal(cierres.get('2026-09-03'), 49800)
  })
})


/**
 * Lo que la previsión le entrega a la cascada. La cascada ya no repite el
 * calendario de los recibos: desglosa lo que el periodo tiene contado, y por
 * eso los cobros se le dan hechos.
 * @param {string} fecha
 * @param {number} importe
 * @param {string} reciboId
 */
function apunte(fecha, importe, reciboId) {
  return { fecha, importe, concepto: reciboId, entidadId: null, reciboId, aplazable: false, previsto: true }
}

/** Los cinco cobros que caen en el periodo que abre la nómina del 25 de septiembre. */
function deOctubre() {
  return [
    apunte('2026-09-27', -58237, 'seguro'),
    apunte('2026-10-01', -5300, 'fibra'),
    apunte('2026-10-01', -45987, 'ibi'),
    apunte('2026-10-10', -46800, 'prestamo'),
    apunte('2026-10-20', -50000, 'fondo'),
  ]
}
