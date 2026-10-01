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

test('apagar una categoría no borra lo que ya te cobraron de ella', () => {
  // Apagar dice «esto no lo voy a volver a gastar», no «esto no lo gasté». El
  // cargo del taller salía del día a día y reaparecía entre los recibos, como
  // si fuese a repetirse, y el cierre del mes cambiaba solo.
  const sueltos = []
  let saldo = 300000
  for (const [i, mes] of ['05', '06', '07', '08'].entries()) {
    saldo -= 4000 + i * 100
    sueltos.push(fila(`c${i}`, `2026-${mes}-07`, `COMPRA BAZAR NUMERO ${i}`, -(4000 + i * 100), saldo))
  }
  // El cargo gordo va dentro del periodo que se está viviendo: es justo el que
  // desaparecía al apagar la categoría.
  saldo -= 60914
  sueltos.push(fila('taller', '2026-09-20', 'COMPRA BAZAR NUMERO TALLER', -60914, saldo))
  const armado = (apagadas) => construirEstado(sueltos, { hoy: HOY, meses: 3, apagadas })

  const normal = armado(undefined)
  const sin = armado({ vehiculos: true })

  const mesDe = (e) => e.detalleMensual.find((m) => m.id === '2026-09')
  assert.ok(mesDe(normal).diaADiaGastado <= -60914, 'el cargo gordo cae en el mes en curso')
  assert.equal(mesDe(sin).diaADiaGastado, mesDe(normal).diaADiaGastado)
  assert.equal(mesDe(sin).compromisos, mesDe(normal).compromisos)
  // Lo que sí tiene que cambiar: deja de contar como costumbre.
  assert.ok(Math.abs(sin.ritmo.porMes) < Math.abs(normal.ritmo.porMes))
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

/**
 * Siete meses de compras sueltas y hoy a dos días de empezar el último: dos
 * compras ya han pasado y las demás no. Es la situación de cualquier día 3.
 *
 * Cada compra es de un sitio distinto a propósito: si el mismo comercio
 * cobrara todos los meses, dejaría de ser día a día y se volvería un recibo.
 */
function conElMesEmpezado() {
  const movimientos = []
  let saldo = 300000
  for (let i = 0; i < 7; i += 1) {
    const mes = String(3 + i).padStart(2, '0')
    saldo += 200000
    movimientos.push(fila(`n${i}`, `2026-${mes}-25`, 'TRANSFERENCIA NOMINA ACME', 200000, saldo))
    for (let j = 0; j < 5; j += 1) {
      const dia = 26 + j
      // Hoy es el 27: del último periodo sólo han pasado dos compras.
      if (i === 6 && dia > 27) continue
      const importe = -(2000 + ((i * 7 + j * 13) % 9) * 500)
      saldo += importe
      movimientos.push(fila(`g${i}-${j}`, `2026-${mes}-${dia}`, `COMPRA TARJ TIENDA ${i}${j}`, importe, saldo))
    }
  }
  return construirEstado(movimientos, { hoy: '2026-09-27', meses: 3 })
}

test('lo ya gastado descuenta de lo que queda por gastar, no se suma a ello', () => {
  const estado = conElMesEmpezado()
  const yaGastado = Math.abs(estado.periodoActual.diaADiaGastado)
  assert.ok(yaGastado > 0, 'el periodo en curso tiene que llevar gasto')
  assert.equal(
    Math.abs(estado.ritmoEfectivo.porMes),
    Math.max(Math.abs(estado.ritmo.porMes) - yaGastado, 0),
  )
})

test('un mes a medias prevé un mes entero de día a día, ni más ni menos', () => {
  /*
   * Gotear la mediana diaria hasta el final hacía que el periodo en curso
   * previera menos gasto cuanto más avanzado estuviera, y la bajamar salía
   * optimista justo cuando más se mira. Se pierde hasta un céntimo por día
   * al repartir el resto, y nada más.
   */
  const estado = conElMesEmpezado()
  const previsto = Math.abs(estado.periodoActual.diaADia)
  const unMesNormal = Math.abs(estado.ritmo.porMes)
  assert.ok(
    Math.abs(previsto - unMesNormal) <= estado.periodoActual.dias,
    `previsto ${previsto} frente a un mes normal ${unMesNormal}`,
  )
})

test('la cascada acaba donde acaba el periodo, no en otro sitio', () => {
  /*
   * Eran dos cuentas del mismo mes hechas por separado: la cascada repetía por
   * su cuenta el calendario de los recibos y así se dejó fuera la liquidación
   * de la tarjeta y volvió a cobrar un agua ya pagada. Cuadraban las dos y no
   * daban lo mismo, a cuatro dedos una de otra en la misma pantalla.
   */
  for (const estado of [armar({ holaluz: 'fijo' }), conElMesEmpezado()]) {
    assert.equal(estado.cascada.cierre, estado.periodoActual.saldoFinal)
  }
})

test('un cobro y su devolución del mismo día no son un gasto', () => {
  // El banco cobra 60 € de comisión cada trimestre y el mismo día te los
  // bonifica. Cada apunte por su lado se leía como un recibo trimestral, y
  // Categorías enseñaba un gasto de 20 € al mes que no existe.
  const movimientos = extracto()
  const saldo = 900000
  for (const fecha of ['2025-03-24', '2025-06-24', '2025-09-24', '2025-12-24', '2026-03-24', '2026-06-24', '2026-09-24']) {
    movimientos.push(fila(`com-${fecha}`, fecha, 'INTERESES Y/O COMISIONES CUENTA', -6000, saldo - 6000))
    movimientos.push(fila(`bon-${fecha}`, fecha, 'BONIFIC. COMISION MANT. CUENTA', 6000, saldo))
  }
  const e = construirEstado(movimientos, { hoy: HOY, meses: 3 })

  const deComisiones = (/** @type {{ nombre: string }} */ c) => /comision/i.test(c.nombre)
  assert.equal(e.compromisos.filter(deComisiones).length, 0, 'la comisión no se prevé')
  assert.equal(e.ingresos.filter(deComisiones).length, 0, 'ni su bonificación')
  // Y no se cuelan en el goteo por la puerta de atrás: no es dinero que gastes.
  assert.equal(e.ordinarios.filter((m) => m.id.startsWith('com-')).length, 0)
})

test('bautizar un plazo bautiza todos los del mismo recibo', () => {
  const movimientos = extracto()
  for (const fecha of ['2025-05-02', '2025-07-01', '2025-10-01', '2026-05-04', '2026-07-01']) {
    movimientos.push(fila(`ibi-${fecha}`, fecha, 'IMPUESTOS AJ. GAVA', -33071, 800000))
    movimientos.push(fila(`bas-${fecha}`, fecha, 'IMPUESTOS AJ. GAVA', -8025, 800000))
  }
  const apodos = {}
  const sinNombre = construirEstado(movimientos, { hoy: HOY, meses: 3 })
  const plazos = sinNombre.compromisos.filter((c) => Math.abs(c.importeEsperado) === 33071)
  assert.ok(plazos.length >= 3, 'el IBI va en varios plazos')
  apodos[plazos[0].reciboId] = 'IBI Martirs'
  const e = construirEstado(movimientos, { hoy: HOY, meses: 3, apodos })
  const bautizados = e.compromisos.filter((c) => c.nombre === 'IBI Martirs')
  assert.equal(bautizados.length, plazos.length, 'el nombre viaja a los demás plazos')
  assert.ok(
    e.compromisos.some((c) => Math.abs(c.importeEsperado) === 8025 && c.nombre !== 'IBI Martirs'),
    'pero no se lleva por delante a la basura, que cuesta otra cosa',
  )
})

test('lo que te devuelven sale de tu cuenta pero no es tu gasto', () => {
  const movimientos = extracto()
  for (const fecha of ['2025-05-02', '2025-07-01', '2025-10-01', '2026-05-04', '2026-07-01']) {
    movimientos.push(fila(`ibi-${fecha}`, fecha, 'IMPUESTOS AJ. GAVA', -4891, 800000))
  }
  const sinMarcar = construirEstado(movimientos, { hoy: HOY, meses: 3 })
  const plazos = sinMarcar.compromisos.filter((c) => Math.abs(c.importeEsperado) === 4891)
  assert.ok(plazos.length >= 3)
  const e = construirEstado(movimientos, { hoy: HOY, meses: 3, devueltos: { [plazos[0].reciboId]: 'Mamá' } })
  const marcados = e.compromisos.filter((c) => c.devuelto === 'Mamá')
  assert.equal(marcados.length, plazos.length, 'marcar un plazo marca todos los del recibo')
  // El dinero sale igual: la previsión es lo único que no puede mentir.
  const saldos = (/** @type {any} */ p) => JSON.stringify(p.dias?.map((/** @type {any} */ d) => d.saldo) ?? p)
  assert.equal(saldos(e.proyeccion), saldos(sinMarcar.proyeccion), 'el suelo previsto no se mueve ni un céntimo')
})

test('del extracto de la tarjeta sólo vale la última foto', () => {
  // Es lo que pasó el 30 de septiembre: la foto del 26 y la del 30 juntas
  // cobraban otra vez los 565,30 € que el banco ya había liquidado.
  const movimientos = extracto()
  const enFoto = (/** @type {string} */ foto, /** @type {number} */ i, /** @type {number} */ importe) => ({
    ...fila(`tarjeta:${foto}-abcd:${i}`, '2026-09-20', 'COMPRA TARJ. CONDIS', importe, 0), origen: 'tarjeta', foto: `${foto} x`,
  })
  movimientos.push(enFoto('2026-09-24', 0, -8000), enFoto('2026-09-24', 1, -20000))
  movimientos.push(enFoto('2026-09-26', 0, -3300))
  const e = construirEstado(movimientos, { hoy: HOY, meses: 2 })
  assert.equal(e.pendienteTarjeta, -3300)
  assert.equal(e.movimientos.filter((m) => m.origen === 'tarjeta').length, 1, 'la foto vieja no se enseña')
})

test('la comisión por divisa es gasto; la de mantenimiento, no', () => {
  const movimientos = extracto()
  movimientos.push(fila('div', '2026-09-02', 'COMISION DIVISA NO EURO', -95, 0))
  movimientos.push(fila('man', '2026-09-24', 'COMISION MANTENIMIENTO', -6000, 0))
  const e = construirEstado(movimientos, { hoy: HOY, meses: 2 })
  const de = (/** @type {string} */ id) => e.movimientos.find((m) => m.id === id)?.categoria
  assert.equal(de('div'), 'compras')
  assert.equal(de('man'), 'banco')
})

test('el próximo cobro de la tarjeta junta los plazos de ese día', () => {
  // Las cifras de la foto del 30 de septiembre: la tercera cuota del IBI y la
  // primera de MyInvestor caen juntas el 31 de octubre.
  const movimientos = extracto()
  for (const [i, f] of ['2026-06-30', '2026-07-31', '2026-08-31', '2026-09-30'].entries()) {
    movimientos.push(fila(`visa${i}`, f, 'TARJETA CREDITO JAVIER CABO ROCA', -20000, 100000))
  }
  const cuota = (/** @type {number} */ i, /** @type {string} */ fecha, /** @type {string} */ concepto, /** @type {number} */ importe) => ({
    ...fila(`tarjeta:2026-09-26-abcd:${i}`, fecha, concepto, importe, 0), origen: 'tarjeta', fraccionado: true, foto: '2026-09-26 x',
  })
  movimientos.push(cuota(0, '2026-09-22', 'TRANSFERENCIA A MyInvesto', -16132))
  movimientos.push(cuota(1, '2026-07-01', 'IMPUESTOS AJ. GAVA', -18545))
  const e = construirEstado(movimientos, { hoy: '2026-09-30', meses: 2 })
  assert.equal(e.proximoCobroTarjeta?.fecha, '2026-10-31')
  assert.equal(e.proximoCobroTarjeta?.importe, -34677)
  assert.equal(e.proximoCobroTarjeta?.luego, -32264, 'las otras dos de MyInvestor')
  assert.equal(e.pendienteTarjeta, 0, 'lo fraccionado va en sus plazos, no en la liquidación')
})

test('Disney+ y HBO Max se reconocen aunque los cobre PayPal', () => {
  const movimientos = extracto()
  for (const [i, mes] of ['06', '07', '08', '09'].entries()) {
    movimientos.push(fila(`d${i}`, `2026-${mes}-24`, 'COMPRA TARJ. 5402XXXXXXXX7032 PAYPAL *DISNEYPLUS-Hoofddorp', -699, 0))
    movimientos.push(fila(`h${i}`, `2026-${mes}-03`, 'COMPRA TARJ. 5402XXXXXXXX7032 PAYPAL *HBOMAX HELP.HB-Stockholm', -549, 0))
  }
  movimientos.push(fila('p', '2026-09-20', 'COMPRA TARJ. 5402XXXXXXXX7032 PAYPAL *PAGO 3 PLAZOS-MADRID', -2240, 0))
  const e = construirEstado(movimientos, { hoy: HOY, meses: 2 })
  const nombreDe = (/** @type {string} */ id) => {
    const m = e.movimientos.find((x) => x.id === id)
    return m?.entidadId ? e.nombres.get(m.entidadId) : null
  }
  assert.equal(nombreDe('d3'), 'Disney+')
  assert.equal(nombreDe('h3'), 'HBO Max')
  assert.equal(nombreDe('p'), 'PayPal', 'lo demás de PayPal sigue siendo PayPal')
  assert.ok(e.compromisos.some((c) => c.nombre === 'Disney+') && e.compromisos.some((c) => c.nombre === 'HBO Max'))
})

test('el taller de la pizza es un restaurante, no un taller', () => {
  const movimientos = extracto()
  movimientos.push(fila('pz', '2026-09-12', 'COMPRA TARJ. 5402XXXXXXXX7032 SUMUP *TALLER DE LA P-GAVA', -2350, 0))
  movimientos.push(fila('tl', '2026-09-13', 'COMPRA TARJ. 5402XXXXXXXX7032 TALLER MECANICO PEPE-GAVA', -9000, 0))
  const e = construirEstado(movimientos, { hoy: HOY, meses: 2 })
  const de = (/** @type {string} */ id) => e.movimientos.find((m) => m.id === id)?.categoria
  assert.equal(de('pz'), 'restaurantes')
  assert.equal(de('tl'), 'vehiculos', 'un taller de verdad sigue siendo un taller')
})

test('el plazo de octubre del IBI se sigue previendo el mismo día que toca', () => {
  // Los recibos reales del ayuntamiento. El 1 de octubre de 2026, a primera hora,
  // el banco aún no ha cobrado los tres de octubre y la app los daba por perdidos.
  const movimientos = extracto()
  const ibi = [
    ['2025-03-03', [4228, 3029]], ['2025-05-02', [4891, 33071, 8025]], ['2025-06-02', [3029, 4228]],
    ['2025-07-01', [11050, 6726, 11514, 4891, 33071, 8025]], ['2025-10-01', [4891, 33071, 8025]],
    ['2025-12-01', [4892, 33072, 8023]], ['2026-03-02', [3029, 4228]], ['2026-05-04', [4891, 33071, 8025]],
    ['2026-06-01', [4228, 3029]], ['2026-07-01', [11050, 6726, 11514, 4891, 33071, 8025]],
  ]
  for (const [fecha, importes] of ibi) {
    for (const [i, importe] of /** @type {number[]} */ (importes).entries()) {
      movimientos.push(fila(`ibi-${fecha}-${i}`, /** @type {string} */ (fecha), 'IMPUESTOS AJ. GAVA', -importe, 0))
    }
  }
  const de = (/** @type {string} */ hoy) => construirEstado(movimientos, { hoy, meses: 2 }).compromisos
    .filter((c) => /m10$/.test(c.reciboId))
    .map((c) => c.importeEsperado)
    .sort((a, b) => a - b)
  assert.deepEqual(de('2026-09-30'), [-33071, -8025, -4891])
  assert.deepEqual(de('2026-10-01'), [-33071, -8025, -4891], 'el día que toca, todavía no ha pasado')
})

test('lo que das por pagado sale hoy, y cuando llega el extracto manda su importe', () => {
  const hoy = '2026-09-05'
  const luzDe = (/** @type {ReturnType<typeof construirEstado>} */ e) =>
    [...e.cascada.fijos, ...e.cascada.toca].filter((f) => /HOLALUZ/i.test(f.nombre))
  const antes = construirEstado(extracto(), { hoy })
  const [pendiente] = luzDe(antes)
  assert.equal(pendiente.previsto, true, 'la luz del 10 todavía no ha pasado')

  const clave = `${pendiente.reciboId}|2026-09`
  const marcado = construirEstado(extracto(), { hoy, pagados: { [clave]: true } })
  const [pagada] = luzDe(marcado)
  assert.equal(pagada.previsto, false)
  assert.equal(pagada.marcado, true)
  assert.equal(pagada.fecha, hoy, 'ha salido hoy, no el día 10')
  assert.equal(marcado.cascada.cierre, antes.cascada.cierre, 'el mes acaba igual: es el mismo dinero')

  // Llega el extracto con el cargo real, que ha subido un poco.
  const conReal = [...extracto(), fila('l-real', '2026-09-09', 'RECIBO HOLALUZ ENERGIA', -6150, 1100000)]
  const confirmado = construirEstado(conReal, { hoy: '2026-09-10', pagados: { [clave]: true } })
  const luces = luzDe(confirmado)
  assert.deepEqual(luces.map((l) => [l.importe, l.previsto, l.marcado]), [[-6150, false, false]],
    'una sola línea, con el importe del banco')
})
