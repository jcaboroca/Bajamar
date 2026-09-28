// @ts-check
/**
 * El ensamblado completo, con la vista puesta en lo que sólo sabe el usuario.
 *
 * Los extractos sólo cuentan el pasado. Que un recibo se haya repetido seis
 * veces no dice nada de la séptima, y ese hueco entre «se repitió» y «va a
 * volver» es el que llenan los tratos.
 */

import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { construirEstado } from '../src/estado.js'

const HOY = '2026-09-26'

/**
 * Seis meses de la misma luz y de la misma nómina, con saldo a la baja.
 * @returns {import('../src/dominio/tipos.js').Movimiento[]}
 */
function extracto() {
  const movimientos = []
  let saldo = 300000
  for (let i = 0; i < 6; i += 1) {
    const mes = String(3 + i).padStart(2, '0')
    saldo += 200000
    movimientos.push(fila(`n${i}`, `2026-${mes}-25`, 'TRANSFERENCIA NOMINA ACME', 200000, saldo))
    saldo -= 6000
    movimientos.push(fila(`l${i}`, `2026-${mes}-10`, 'RECIBO HOLALUZ ENERGIA', -6000, saldo))
    saldo -= 4000
    movimientos.push(fila(`g${i}`, `2026-${mes}-05`, 'COMPRA SUPERMERCADO', -4000, saldo))
  }
  return movimientos
}

/**
 * @param {string} id
 * @param {string} fecha
 * @param {string} concepto
 * @param {number} importe
 * @param {number} saldo
 * @returns {import('../src/dominio/tipos.js').Movimiento}
 */
function fila(id, fecha, concepto, importe, saldo) {
  return {
    id,
    fecha,
    fechaValor: fecha,
    conceptoRaw: concepto,
    entidadId: null,
    importe,
    saldo,
    origen: 'cuenta',
    localidad: null,
    fraccionado: false,
    excepcional: false,
  }
}

/** @param {Record<string, 'fijo' | 'suelto' | 'baja'>} [tratos] */
const armar = (tratos) => construirEstado(extracto(), { hoy: HOY, tratos, meses: 3 })

/**
 * El mismo banco cobrando dos cosas que no son la misma: una aportación
 * mensual y la letra de una furgoneta.
 * @param {Record<string, 'fijo' | 'suelto' | 'baja'>} [tratos]
 */
function dosDelMismoBanco(tratos) {
  const movimientos = extracto()
  for (let i = 0; i < 6; i += 1) {
    const mes = String(3 + i).padStart(2, '0')
    movimientos.push(fila(`a${i}`, `2026-${mes}-05`, 'TRANSFERENCIA MYINVESTOR', -50000, 100000))
    movimientos.push(fila(`v${i}`, `2026-${mes}-18`, 'TRANSFERENCIA MYINVESTOR', -46800, 100000))
  }
  return construirEstado(movimientos, { hoy: HOY, tratos, meses: 3 })
}

/** @param {ReturnType<typeof construirEstado>} estado */
const laLuz = (estado) => estado.fijos.find((f) => /HOLALUZ/i.test(f.nombre)) ?? null

test('de serie, un recibo repetido se da por vivo y se prevé', () => {
  const estado = armar()
  assert.ok(laLuz(estado), 'la luz debería reconocerse como gasto fijo')
  assert.ok(estado.proyeccion.eventos.some((e) => /HOLALUZ/i.test(e.nombre)))
})

test('darlo de baja lo borra de la previsión y del coste fijo', () => {
  const antes = armar()
  const luz = laLuz(antes)
  assert.ok(luz)

  const despues = armar({ [luz.reciboId]: 'baja' })
  assert.equal(laLuz(despues), null)
  assert.ok(!despues.proyeccion.eventos.some((e) => /HOLALUZ/i.test(e.nombre)))
  assert.equal(antes.costes.costeMensual, -10000)
  assert.equal(despues.costes.costeMensual, -4000)
})

test('lo que ya no se paga tampoco engorda el goteo diario', () => {
  const antes = armar()
  const luz = laLuz(antes)
  assert.ok(luz)

  const despues = armar({ [luz.reciboId]: 'baja' })
  assert.equal(despues.ritmo.porDia, antes.ritmo.porDia)
})

test('lo saltable se sigue previendo: el dinero sale casi todos los meses', () => {
  const luz = laLuz(armar())
  assert.ok(luz)

  const estado = armar({ [luz.reciboId]: 'suelto' })
  const sigue = laLuz(estado)
  assert.ok(sigue, 'tiene que seguir en la lista de fijos')
  assert.equal(sigue.aplazable, true)
  assert.ok(estado.proyeccion.eventos.some((e) => /HOLALUZ/i.test(e.nombre)))
  assert.equal(estado.proyeccion.suelo.saldo, armar().proyeccion.suelo.saldo)
})

test('de lo saltable se mide el margen que daría saltarlo', () => {
  const luz = laLuz(armar())
  assert.ok(luz)

  assert.equal(armar().margen, null, 'sin nada saltable no hay margen que contar')

  const estado = armar({ [luz.reciboId]: 'suelto' })
  assert.ok(estado.margen)
  assert.equal(estado.aplazableAlMes, -6000)
  assert.ok(estado.margen.gana > 0, 'saltarse un gasto sólo puede subir el suelo')
  assert.equal(estado.margen.suelo.saldo, estado.proyeccion.suelo.saldo + estado.margen.gana)
})

test('sólo lo dado de baja se aparta; lo saltable sigue a la vista', () => {
  const luz = laLuz(armar())
  assert.ok(luz)

  assert.equal(armar({ [luz.reciboId]: 'suelto' }).apartados.length, 0)
  assert.deepEqual(
    armar({ [luz.reciboId]: 'baja' }).apartados.map((a) => a.reciboId),
    [luz.reciboId],
  )
})

test('dos recibos del mismo cobrador se contestan por separado', () => {
  const suyos = dosDelMismoBanco().fijos.filter((f) => /MYINVESTOR/i.test(f.nombre))
  assert.equal(suyos.length, 2, 'la aportación y la letra son dos recibos, no uno')
  assert.equal(suyos[0].entidadId, suyos[1].entidadId)
  assert.equal(new Set(suyos.map((f) => f.reciboId)).size, 2)

  const aportacion = suyos.find((f) => f.importeEsperado === -50000)
  assert.ok(aportacion)
  const estado = dosDelMismoBanco({ [aportacion.reciboId]: 'suelto' })
  const despues = estado.fijos.filter((f) => /MYINVESTOR/i.test(f.nombre))
  assert.equal(estado.aplazableAlMes, -50000, 'la letra de la furgoneta no se salta')
  assert.deepEqual(despues.map((f) => f.aplazable).sort(), [false, true])
})

test('una respuesta dada al cobrador no se pierde al separarse sus recibos', () => {
  // La luz tiene un solo recibo, así que no hay duda de a cuál se refería.
  const luz = laLuz(armar())
  assert.ok(luz)
  assert.equal(armar({ [luz.entidadId]: 'baja' }).apartados.length, 1)

  // MyInvestor tiene dos: adivinar cuál sería peor que volver a preguntar.
  assert.equal(dosDelMismoBanco({ myinvestor: 'suelto' }).aplazableAlMes, 0)
})

test('los eventos previstos dicen de quién salen, para poder decirles que no', () => {
  const estado = armar()
  const luz = estado.proyeccion.eventos.find((e) => /HOLALUZ/i.test(e.nombre))
  assert.ok(luz)
  assert.equal(typeof luz.entidadId, 'string')
})

test('el saldo automático del patrimonio nunca se fecha por delante de hoy', () => {
  const futuro = extracto()
  futuro.push(fila('x', '2026-09-30', 'COMPRA SUPERMERCADO', -1000, 1000000))
  const estado = construirEstado(futuro, { hoy: HOY })
  assert.equal(estado.patrimonio.neto, 1000000)
})

test('el nombre que pone el usuario sustituye al del banco en todas partes', () => {
  const movimientos = extracto()
  for (let i = 0; i < 6; i += 1) {
    const mes = String(3 + i).padStart(2, '0')
    movimientos.push(fila(`p${i}`, `2026-${mes}-24`, 'ADEUDO RECIBO PayPal', -699, 100000))
  }
  const sinNombre = construirEstado(movimientos, { hoy: HOY, meses: 3 })
  const recibo = sinNombre.fijos.find((f) => /paypal/i.test(f.nombre))
  assert.ok(recibo, 'la suscripcion se detecta')

  const conNombre = construirEstado(movimientos, {
    hoy: HOY, meses: 3, apodos: { [recibo.reciboId]: 'Disney+' },
  })
  assert.equal(conNombre.fijos.find((f) => f.reciboId === recibo.reciboId)?.nombre, 'Disney+')
  const evento = conNombre.proyeccion.eventos.find((e) => e.reciboId === recibo.reciboId)
  assert.equal(evento?.nombre, 'Disney+', 'tambien en lo que viene')
})

test('un nombre puesto a un recibo no se le pega a los demas del mismo cobrador', () => {
  const dos = dosDelMismoBanco({})
  const [uno, otro] = dos.fijos.filter((f) => /MYINVESTOR/i.test(f.nombre))
  assert.ok(uno && otro, 'son dos recibos distintos')

  const movimientos = extracto()
  for (let i = 0; i < 6; i += 1) {
    const mes = String(3 + i).padStart(2, '0')
    movimientos.push(fila(`a${i}`, `2026-${mes}-05`, 'TRANSFERENCIA MYINVESTOR', -50000, 100000))
    movimientos.push(fila(`v${i}`, `2026-${mes}-18`, 'TRANSFERENCIA MYINVESTOR', -46800, 100000))
  }
  const bautizado = construirEstado(movimientos, {
    hoy: HOY, meses: 3, apodos: { [uno.reciboId]: 'La furgoneta' },
  })
  assert.equal(bautizado.fijos.find((f) => f.reciboId === uno.reciboId)?.nombre, 'La furgoneta')
  assert.match(bautizado.fijos.find((f) => f.reciboId === otro.reciboId)?.nombre ?? '', /MYINVESTOR/i)
})

test('lo que no sé clasificar se ordena por lo que pesa, no por cuántas veces', () => {
  const movimientos = extracto()
  movimientos.push(fila('x1', '2026-06-11', 'COMPRA TARJ. ELECTRICITAT BOQUET SL', -193393, 100000))
  for (let i = 0; i < 9; i += 1) {
    movimientos.push(fila(`x2-${i}`, `2026-0${1 + (i % 8)}-14`, 'COMPRA TARJ. KIOSCO PEPE', -500, 100000))
  }

  const estado = construirEstado(movimientos, { hoy: HOY })
  const pendientes = estado.sinClasificar.map((p) => p.nombre)
  assert.match(pendientes[0], /BOQUET/i, 'un pago gordo pesa más que nueve pequeños')
  assert.ok(
    pendientes.findIndex((n) => /PEPE/i.test(n)) > 0,
    'el kiosco aparece, pero detrás de lo que pesa',
  )
  assert.equal(estado.sinClasificar.find((p) => /PEPE/i.test(p.nombre))?.cuantos, 9)

  const gordo = estado.sinClasificar[0]
  const clasificado = construirEstado(movimientos, {
    hoy: HOY, categoriasManuales: { [gordo.entidadId]: 'hogar' },
  })
  assert.ok(
    !clasificado.sinClasificar.some((p) => p.entidadId === gordo.entidadId),
    'contestado una vez, no vuelve a preguntar',
  )
})

test('una categoría apagada sale del goteo y de las barras', () => {
  // Comercios distintos cada vez: nada se repite, así que todo es goteo y no
  // hay recibos de por medio que enturbien la cuenta.
  const sueltos = []
  let saldo = 300000
  for (const [i, mes] of ['05', '06', '07', '08'].entries()) {
    saldo -= 4000 + i * 100
    sueltos.push(fila(`c${i}`, `2026-${mes}-07`, `COMPRA BAZAR NUMERO ${i}`, -(4000 + i * 100), saldo))
  }
  const armado = (apagadas) => construirEstado(sueltos, { hoy: HOY, meses: 3, apagadas })

  const normal = armado(undefined)
  const gorda = normal.reparto[0]
  const sin = armado({ [gorda.categoria]: true })

  assert.ok(Math.abs(sin.ritmo.porMes) < Math.abs(normal.ritmo.porMes))
  assert.equal(sin.reparto.some((t) => t.categoria === gorda.categoria), false)
  // Sigue nombrada para poder volver a encenderla.
  assert.deepEqual(sin.apagadas, [gorda.categoria])
})

test('cada periodo lleva dentro la nómina que lo paga', () => {
  // Con meses naturales, el mes siguiente salía siempre con cero ingresos: su
  // nómina había caído en el mes anterior y hacía falta un parche para
  // recuperarla. Yendo de nómina a nómina eso no puede pasar, porque la que
  // abre el periodo está dentro de él por definición.
  const movimientos = []
  let saldo = 400000
  for (let i = 0; i < 6; i += 1) {
    const mes = String(4 + i).padStart(2, '0')
    saldo += 200000
    movimientos.push(fila(`n${i}`, `2026-${mes}-25`, 'TRANSFERENCIA NOMINA ACME', 200000, saldo))
    saldo -= 60000
    movimientos.push(fila(`a${i}`, `2026-${mes}-01`, 'RECIBO ALQUILER VIVIENDA', -60000, saldo))
  }
  const estado = construirEstado(movimientos, { hoy: '2026-09-28', meses: 3 })

  const cerrados = estado.detalleMensual.filter((p) => p.estado === 'cerrado' && p.completo)
  assert.ok(cerrados.length >= 2, 'el extracto da para varios periodos cerrados')
  for (const p of cerrados) {
    assert.equal(p.ingresos.real, 200000, `${p.id} tiene que llevar su nómina dentro`)
    assert.ok(p.ahorro > 0, `${p.id} no puede cerrar en rojo con una nómina de 2.000 €`)
  }
})

test('la cascada y el resumen no pueden dar cifras distintas del mismo mes', () => {
  // El ritmo del plan es «lo que queda entre los días que quedan» del mes en
  // curso. Multiplicarlo por los días del mes siguiente daba un día a día
  // absurdo: la cascada cerraba octubre en rojo mientras el resumen lo daba
  // por ahorrado.
  const movimientos = []
  let saldo = 400000
  let n = 0
  for (let i = 0; i < 6; i += 1) {
    const mes = String(4 + i).padStart(2, '0')
    saldo += 200000
    movimientos.push(fila(`n${i}`, `2026-${mes}-25`, 'TRANSFERENCIA NOMINA ACME', 200000, saldo))
    saldo -= 60000
    movimientos.push(fila(`a${i}`, `2026-${mes}-01`, 'RECIBO ALQUILER VIVIENDA', -60000, saldo))
    // Gasto irregular: días e importes distintos, para que no se confunda con
    // un recibo y quede como goteo del día a día.
    for (const [dia, importe] of [['07', -3150], ['12', -2780], ['21', -4310]]) {
      saldo -= Math.abs(importe)
      movimientos.push(fila(`b${n++}`, `2026-${mes}-${dia}`, `BAR LA PLACETA ${i}${dia}`, importe, saldo))
    }
  }
  // Un plan del mes en curso, con casi nada de mes por delante: es lo que
  // disparaba el ritmo diario.
  const planes = {
    '2026-09': { mes: '2026-09', asignado: { restaurantes: 20000 }, residuo: 100000, sello: '2026-09-28' },
  }
  const estado = construirEstado(movimientos, { hoy: '2026-09-28', meses: 3, planes })

  assert.equal(estado.cascada.mes, '2026-10')
  assert.ok(Math.abs(estado.ritmo.porMes) > 0, 'el fixture tiene que producir goteo')
  // Sin plan de octubre, su día a día es el goteo medido del mes, no el ritmo
  // de septiembre estirado a treinta y un días.
  assert.ok(
    Math.abs(estado.cascada.diaADia) < Math.abs(estado.ritmo.porMes) * 2,
    `el día a día de la cascada se ha disparado: ${estado.cascada.diaADia} `
    + `frente a un goteo medido de ${estado.ritmo.porMes}`,
  )
})
