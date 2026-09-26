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

  const despues = armar({ [luz.entidadId]: 'baja' })
  assert.equal(laLuz(despues), null)
  assert.ok(!despues.proyeccion.eventos.some((e) => /HOLALUZ/i.test(e.nombre)))
  assert.equal(antes.costes.costeMensual, -10000)
  assert.equal(despues.costes.costeMensual, -4000)
})

test('lo que ya no se paga tampoco engorda el goteo diario', () => {
  const antes = armar()
  const luz = laLuz(antes)
  assert.ok(luz)

  const despues = armar({ [luz.entidadId]: 'baja' })
  assert.equal(despues.ritmo.porDia, antes.ritmo.porDia)
})

test('lo saltable se sigue previendo: el dinero sale casi todos los meses', () => {
  const luz = laLuz(armar())
  assert.ok(luz)

  const estado = armar({ [luz.entidadId]: 'suelto' })
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

  const estado = armar({ [luz.entidadId]: 'suelto' })
  assert.ok(estado.margen)
  assert.equal(estado.aplazableAlMes, -6000)
  assert.ok(estado.margen.gana > 0, 'saltarse un gasto sólo puede subir el suelo')
  assert.equal(estado.margen.suelo.saldo, estado.proyeccion.suelo.saldo + estado.margen.gana)
})

test('sólo lo dado de baja se aparta; lo saltable sigue a la vista', () => {
  const luz = laLuz(armar())
  assert.ok(luz)

  assert.equal(armar({ [luz.entidadId]: 'suelto' }).apartados.length, 0)
  assert.deepEqual(
    armar({ [luz.entidadId]: 'baja' }).apartados.map((a) => a.entidadId),
    [luz.entidadId],
  )
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
