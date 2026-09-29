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

  test('dos septiembres cobrando lo mismo el mismo día sí son un recibo anual', () => {
    // Con veinte meses de extractos una tercera vista no existe. Exigirla es
    // dejar el seguro del coche contado como gasto del día a día para siempre.
    const { compromisos } = detectarCompromisos(
      [mov('2025-09-24', -58237), mov('2026-09-24', -58237)],
      NOMBRES,
      { hoy: '2026-09-28' },
    )
    assert.equal(compromisos.length, 1)
    assert.equal(compromisos[0].periodicidad, 'anual')
    assert.equal(compromisos[0].importeEsperado, -58237)
    assert.equal(compromisos[0].proximaPrevista, '2027-09-24')
  })

  test('dos apariciones a once meses y medio no son un recibo anual', () => {
    const { compromisos } = detectarCompromisos(
      [mov('2025-09-24', -58237), mov('2026-09-09', -58237)],
      NOMBRES,
      { hoy: '2026-09-28' },
    )
    assert.deepEqual(compromisos, [], 'un recibo anual cae casi en el mismo día')
  })

  test('dos apariciones al año con precios distintos no son un recibo anual', () => {
    const { compromisos } = detectarCompromisos(
      [mov('2025-09-24', -58237), mov('2026-09-24', -71000)],
      NOMBRES,
      { hoy: '2026-09-28' },
    )
    assert.deepEqual(compromisos, [], 'sin una tercera vista, el precio tiene que cuadrar')
  })

  test('los apuntes del mismo día del ayuntamiento son una factura, no tres', () => {
    const plazos = [
      ['2025-10-01', -33071], ['2025-10-01', -4891], ['2025-10-01', -8025],
      ['2026-10-01', -33071], ['2026-10-01', -4891], ['2026-10-01', -8025],
    ]
    const { compromisos } = detectarCompromisos(
      plazos.map(([f, i]) => mov(/** @type {string} */ (f), Number(i))),
      NOMBRES,
      { hoy: '2026-10-15' },
    )
    assert.equal(compromisos.length, 1, 'el IBI, la basura y el vado son un recibo')
    assert.equal(compromisos[0].importeEsperado, -45987)
    assert.equal(compromisos[0].proximaPrevista, '2027-10-01')
  })

  test('el plazo del que sólo hay uno cuenta si el cobrador ya probó su calendario', () => {
    // Marzo y mayo se repiten los dos años: el ayuntamiento cobra en fechas
    // fijas. Octubre tiene una sola factura porque la segunda aún no ha caído.
    const plazos = [
      ['2025-03-03', -7257], ['2026-03-02', -7257],
      ['2025-05-02', -45987], ['2026-05-04', -45987],
      ['2025-06-02', -7257], ['2026-06-01', -7257],
      ['2025-10-01', -45987],
    ]
    const { compromisos } = detectarCompromisos(
      plazos.map(([f, i]) => mov(/** @type {string} */ (f), Number(i))),
      NOMBRES,
      { hoy: '2026-09-27' },
    )
    const octubre = compromisos.find((c) => c.proximaPrevista === '2026-10-01')
    assert.ok(octubre, `esperaba el plazo de octubre, tengo ${compromisos.map((c) => c.proximaPrevista)}`)
    assert.equal(octubre.importeEsperado, -45987)
  })

  test('una factura suelta cuyo aniversario ya pasó sin repetirse no vuelve', () => {
    const plazos = [
      ['2025-03-03', -7257], ['2026-03-02', -7257],
      ['2025-05-02', -45987], ['2026-05-04', -45987],
      ['2025-06-02', -7257], ['2026-06-01', -7257],
      ['2024-11-05', -31000],
    ]
    const { compromisos } = detectarCompromisos(
      plazos.map(([f, i]) => mov(/** @type {string} */ (f), Number(i))),
      NOMBRES,
      { hoy: '2026-09-27' },
    )
    assert.equal(compromisos.length, 3, 'noviembre de 2024 tuvo su turno en 2025 y no volvió')
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
    const recibo = mov('2026-09-01', -3800)
    const movimientos = [
      recibo,
      mov('2026-09-02', -2000, { entidadId: 'super' }),       // ordinario
      mov('2026-09-03', -9000, { origen: 'tarjeta', entidadId: 'super' }),
      mov('2026-09-04', -50000, { entidadId: 'super', excepcional: true }),
      mov('2026-09-05', -50000, { entidadId: 'ahorro' }),     // traspaso
      mov('2026-09-06', 300000, { entidadId: 'super' }),      // ingreso
    ]
    const compromisos = [{ entidadId: 'e', cobros: [recibo.id] }]
    const ordinarios = gastoOrdinario(
      movimientos,
      /** @type {any} */ (compromisos),
      new Set(['traspaso']),
      new Map([['ahorro', 'traspaso'], ['super', 'super']]),
    )
    assert.deepEqual(ordinarios.map((m) => m.importe), [-2000])
  })

  test('lo demás que cobra el mismo cobrador sigue siendo gasto del día a día', () => {
    // Bajo un solo PayPal caben una suscripción y cien compras sueltas.
    const suscripciones = ['2026-07-24', '2026-08-24', '2026-09-24']
      .map((f) => mov(f, -699, { entidadId: 'paypal' }))
    const compras = [mov('2026-08-11', -4500, { entidadId: 'paypal' })]
    const compromisos = [{ entidadId: 'paypal', cobros: suscripciones.map((m) => m.id) }]
    const ordinarios = gastoOrdinario(
      [...suscripciones, ...compras],
      /** @type {any} */ (compromisos),
      new Set(),
      new Map([['paypal', 'compras']]),
    )
    assert.deepEqual(ordinarios.map((m) => m.importe), [-4500])
  })

  test('lo que llega con recibo no es goteo: ya tiene su linea', () => {
    // El IBI o el seguro se preven uno a uno, con su fecha y su importe. Si
    // ademas engordaran la media diaria, el mismo dinero saldria dos veces.
    const movimientos = [
      mov('2026-08-10', -42800, { entidadId: 'ayto' }),
      mov('2026-08-11', -32200, { entidadId: 'mapfre' }),
      mov('2026-08-12', -2000, { entidadId: 'super' }),
    ]
    const ordinarios = gastoOrdinario(
      movimientos,
      /** @type {any} */ ([]),
      new Set(['impuestos', 'seguros']),
      new Map([['ayto', 'impuestos'], ['mapfre', 'seguros'], ['super', 'super']]),
    )
    assert.deepEqual(ordinarios.map((m) => m.importe), [-2000])
  })

  test('la ventana recorta el historial: los meses viejos no te describen', () => {
    // Doce meses caros y tres baratos. Mirarlo todo dice que gastas mucho;
    // mirar los ultimos tres dice lo que gastas ahora. Las dos son ciertas.
    const movimientos = []
    for (let i = 1; i <= 12; i += 1) {
      movimientos.push(mov(`2025-${String(i).padStart(2, '0')}-05`, -100000))
    }
    for (const mes of ['01', '02', '03']) {
      movimientos.push(mov(`2026-${mes}-05`, -20000))
    }
    movimientos.push(mov('2026-04-05', -500))

    assert.equal(ritmoOrdinario(movimientos, 0).porMes, -100000)
    assert.equal(ritmoOrdinario(movimientos, 3).porMes, -20000)
    // El mes en curso sigue sin contar aunque se pida una ventana corta.
    assert.equal(ritmoOrdinario(movimientos, 3).meses, 3)
    assert.equal(ritmoOrdinario(movimientos, 0).disponibles, 15)
  })

  test('la liquidacion de la tarjeta no es goteo: se proyecta aparte', () => {
    // Las compras ya estan fuera por venir del extracto de la tarjeta. Si
    // ademas contaramos el cargo que las agrupa, el mismo dinero saldria dos
    // veces: una en el goteo y otra en la liquidacion que se proyecta sola.
    const movimientos = [
      mov('2026-08-31', -66400, { entidadId: 'visa' }),
      mov('2026-09-02', -2000, { entidadId: 'super' }),
    ]
    const ordinarios = gastoOrdinario(
      movimientos,
      /** @type {any} */ ([]),
      new Set(['tarjeta']),
      new Map([['visa', 'tarjeta'], ['super', 'super']]),
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

/**
 * Un pagador opaco —PayPal, Bizum— cobra por igual dos suscripciones y cien
 * compras sueltas. Si las series se encadenan por parecido de importe, con
 * suficientes cobros pequeños todo acaba siendo un solo grupo y no se detecta
 * nada.
 */
describe('varias series bajo un mismo cobrador opaco', () => {
  const meses = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']

  test('dos suscripciones de precio parecido no se funden en una', () => {
    const { compromisos } = detectarCompromisos(
      [
        ...meses.map((m) => mov(`${m}-24`, -699, { entidadId: 'paypal' })),
        ...meses.map((m) => mov(`${m}-04`, -549, { entidadId: 'paypal' })),
      ],
      new Map([['paypal', 'PayPal']]),
      { hoy: '2026-09-10' },
    )
    assert.deepEqual(
      compromisos.map((c) => c.importeEsperado).sort((a, b) => a - b),
      [-699, -549],
    )
  })

  test('las compras sueltas no impiden ver la suscripción', () => {
    const sueltas = [-1234, -2750, -890, -4510, -1999, -640, -760, -3120]
      .map((i, n) => mov(`2026-0${(n % 6) + 3}-1${n}`, i, { entidadId: 'paypal' }))
    const { compromisos } = detectarCompromisos(
      [...meses.map((m) => mov(`${m}-24`, -699, { entidadId: 'paypal' })), ...sueltas],
      new Map([['paypal', 'PayPal']]),
      { hoy: '2026-09-10' },
    )
    assert.equal(compromisos.length, 1)
    assert.equal(compromisos[0].importeEsperado, -699)
  })

  test('una subida de precio no parte la serie en dos', () => {
    const { compromisos } = detectarCompromisos(
      [
        ...['2026-03', '2026-04', '2026-05'].map((m) => mov(`${m}-24`, -699, { entidadId: 'paypal' })),
        ...['2026-06', '2026-07', '2026-08'].map((m) => mov(`${m}-24`, -729, { entidadId: 'paypal' })),
        ...meses.map((m) => mov(`${m}-04`, -549, { entidadId: 'paypal' })),
      ],
      new Map([['paypal', 'PayPal']]),
      { hoy: '2026-09-10' },
    )
    assert.equal(compromisos.length, 2)
    assert.equal(compromisos.find((c) => c.importeEsperado < -600)?.observaciones, 6)
  })
})

describe('lo que costará la próxima vez', () => {
  const fibra = (fechas, importe) => fechas.map((f) => mov(f, importe, { entidadId: 'o2' }))

  test('una cuota que nunca varió y sube dos veces seguidas ya cuesta lo nuevo', () => {
    const { compromisos } = detectarCompromisos(
      [
        ...fibra([
          '2025-01-02', '2025-02-03', '2025-03-03', '2025-04-01', '2025-05-02', '2025-06-02',
          '2025-07-01', '2025-08-01', '2025-09-01', '2025-10-01', '2025-11-03', '2025-12-01',
          '2026-01-02', '2026-02-02', '2026-03-02', '2026-04-01', '2026-05-04', '2026-06-01',
          '2026-07-01',
        ], -3800),
        mov('2026-08-03', -4550, { entidadId: 'o2' }),
        mov('2026-09-01', -5300, { entidadId: 'o2' }),
      ],
      new Map([['o2', 'O2 Fibra']]),
      { hoy: '2026-09-27' },
    )
    assert.equal(compromisos.length, 1)
    assert.equal(compromisos[0].importeEsperado, -5300, 'la mediana prometería el precio viejo un año')
  })

  test('un recibo que varía todos los meses no persigue al último', () => {
    const luz = [
      ['2026-02-24', -3063], ['2026-03-19', -4345], ['2026-04-28', -3711], ['2026-05-21', -3421],
      ['2026-06-17', -2623], ['2026-07-20', -3121], ['2026-09-03', -1914], ['2026-09-21', -1622],
    ]
    const { compromisos } = detectarCompromisos(
      luz.map(([f, i]) => mov(f, i, { entidadId: 'luz' })),
      new Map([['luz', 'La luz']]),
      { hoy: '2026-09-27' },
    )
    assert.equal(compromisos.length, 1)
    assert.equal(compromisos[0].importeEsperado, -3092, 'dos meses baratos no son una bajada de precio')
  })

  test('unas compras parecidas espaciadas tres meses no son un recibo trimestral', () => {
    const compras = [
      ['2025-03-18', -699], ['2025-07-30', -767], ['2025-10-06', -645], ['2026-01-12', -690],
      ['2026-02-16', -695], ['2026-03-03', -739], ['2026-04-10', -669],
    ]
    const { compromisos } = detectarCompromisos(
      compras.map(([f, i]) => mov(f, i, { entidadId: 'amazon' })),
      new Map([['amazon', 'Amazon']]),
      { hoy: '2026-09-27' },
    )
    assert.deepEqual(compromisos, [], 'una suscripción cuesta lo mismo, no algo parecido')
  })
})

describe('un recibo que llega tarde', () => {
  test('unos días de retraso no lo empujan al año que viene', () => {
    // El seguro se cobró dos veces un 24 de septiembre y hoy es 27 de
    // septiembre del año siguiente: lleva tres días de retraso. Sigue siendo el
    // cobro de este año, a punto de caer, no el del que viene.
    const { compromisos } = detectarCompromisos(
      [mov('2024-09-24', -58237), mov('2025-09-24', -58237)],
      NOMBRES,
      { hoy: '2026-09-27' },
    )
    assert.equal(compromisos.length, 1)
    assert.equal(compromisos[0].proximaPrevista, '2026-09-27', 'se espera ya, no en 2027')
    assert.equal(compromisos[0].estado, 'activo')
  })
})

describe('un cobrador con más de una cosa dentro', () => {
  const NOMBRES_APPLE = new Map([['e', 'Apple']])

  // Caso real: la cuota de 9,99 al mes, la licencia de desarrollador de 99 al
  // año y varias compras sueltas, todo bajo el mismo nombre.
  const APPLE = [
    ['2025-01-07', -699], ['2025-06-04', -2249], ['2025-07-04', -2249],
    ['2025-08-04', -2249], ['2025-08-27', -9900], ['2025-11-17', -1299],
    ['2026-01-07', -999], ['2026-02-09', -999], ['2026-03-09', -999],
    ['2026-04-07', -999], ['2026-05-07', -999], ['2026-06-08', -999],
    ['2026-07-07', -999], ['2026-08-07', -999], ['2026-09-07', -999],
  ]

  test('la cuota se separa de las compras sueltas', () => {
    const { compromisos } = detectarCompromisos(
      APPLE.map(([f, v]) => mov(f, v)),
      NOMBRES_APPLE,
      { hoy: '2026-09-29' },
    )
    const cuota = compromisos.filter((c) => c.importeEsperado === -999)
    assert.equal(cuota.length, 1, 'la cuota mensual tiene que salir')
    assert.equal(cuota[0].periodicidad, 'mensual')
    assert.ok(cuota[0].observaciones < APPLE.length, 'no puede llevarse todo dentro')
  })

  test('una licencia de 99 € no es ruido de una cuota de 9,99', () => {
    // Daba igual dónde se cortara: con un 30 % de holgura, el cargo grande
    // colaba como si fuera la misma cuota con otro redondeo.
    const { compromisos } = detectarCompromisos(
      APPLE.map(([f, v]) => mov(f, v)),
      NOMBRES_APPLE,
      { hoy: '2026-09-29' },
    )
    const todoJunto = compromisos.some((c) => c.observaciones === APPLE.length)
    assert.equal(todoJunto, false)
  })

  test('una suscripción que sube de precio dos veces sigue siendo una', () => {
    // Netflix: 13,99 hasta junio de 2025, 6,99 hasta abril de 2026 y 8,99
    // desde entonces. Tres tramos planos, no tres cosas distintas.
    const fechas = [
      '2025-01-02', '2025-01-31', '2025-02-28', '2025-03-31', '2025-04-30',
      '2025-06-02', '2025-06-30', '2025-07-31', '2025-09-01', '2025-09-30',
      '2025-10-31', '2025-12-01', '2025-12-31', '2026-02-02', '2026-03-02',
      '2026-03-31', '2026-04-30', '2026-06-01', '2026-06-30', '2026-07-31',
      '2026-08-31',
    ]
    const importes = [
      -1399, -1399, -1399, -1399, -1399, -1399, -1399,
      -699, -699, -699, -699, -699, -699, -699, -699, -699, -699,
      -899, -899, -899, -899,
    ]
    const { compromisos } = detectarCompromisos(
      fechas.map((f, i) => mov(f, importes[i])),
      new Map([['e', 'Netflix']]),
      { hoy: '2026-09-29' },
    )
    assert.equal(compromisos.length, 1)
    assert.equal(compromisos[0].periodicidad, 'mensual')
    assert.equal(compromisos[0].importeEsperado, -899, 'vale lo que vale ahora')
  })
})
