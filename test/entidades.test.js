// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { limpiarConcepto, normalizar } from '../src/entidades/limpiar.js'
import { idDesde, mismaPersona, reconciliar } from '../src/entidades/reconciliar.js'

describe('limpiarConcepto', () => {
  /** @type {Array<[string, string, string | null, string | null]>} */
  const casos = [
    ['COMPRA TARJ. 5402XXXXXXXX7032 CONDIS GAVA-GAVA', 'CONDIS GAVA', 'GAVA', null],
    ['COMPRA TARJ. 5402XXXXXXXX7032 CARREF GAVA-GAVA', 'CARREF GAVA', 'GAVA', null],
    ['COMPRA TARJ. 5402XXXXXXXX7032 WWW.AMAZON-LUXEMBOURG', 'WWW.AMAZON', 'LUXEMBOURG', null],
    ['COMPRA TARJ. 5402XXXXXXXX7032 PAYPAL *DISNEYPLUS-Hoofddorp', 'PAYPAL DISNEYPLUS', 'HOOFDDORP', null],
    ['ELECTRICIDAD NEXUS ENERGIA SA', 'NEXUS ENERGIA SA', null, 'luz'],
    ['AGUA AIGUES DE BARCELONA SUBMINISTRAMENT D', 'AIGUES DE BARCELONA SUBMINISTRAMENT D', null, 'agua'],
    ['ADEUDO RECIBO MAPFRE', 'MAPFRE', null, null],
    ['SEGUROS ADESLAS BARCELONA', 'ADESLAS BARCELONA', null, 'seguros'],
    ['PAGO BIZUM CARMEN AMPARO BENITEZ LARA', 'CARMEN AMPARO BENITEZ LARA', null, 'bizum-enviado'],
    ['ABONO BIZUM DE NURIA MORENO VEGA', 'NURIA MORENO VEGA', null, 'bizum-recibido'],
    ['FRACCIONAMIENTO TRANSFERENCIA A MyInvestor', 'MYINVESTOR', null, 'fraccionamiento'],
    ['IMPUESTOS AJ. GAVA', 'IMPUESTOS AJ. GAVA', null, null],
    ['NOMINA ERNI CONSULTING ESPANA SLU', 'ERNI CONSULTING ESPANA SLU', null, 'nomina'],
  ]

  for (const [raw, nombre, localidad, pista] of casos) {
    test(raw, () => {
      assert.deepEqual(limpiarConcepto(raw), { nombre, localidad, pista })
    })
  }

  test('el guion que une dos partes del nombre no es una localidad', () => {
    const r = limpiarConcepto('TELEFONOS O2 FIBRA - TELEFONICA DE ESPANA SAU')
    assert.equal(r.localidad, null)
    assert.equal(r.pista, 'telecom')
  })

  test('un teléfono detrás del guion no es una localidad', () => {
    assert.equal(limpiarConcepto('COMPRA TARJ. 5402XXXXXXXX7032 AMAZON-+18002796620').localidad, null)
  })

  test('quita la fecha incrustada de las compras en el extranjero', () => {
    const c = limpiarConcepto('COMPRA TARJ. 5402XXXXXXXX7032 24.06 SHELL 1211-BONNEVILLE')
    assert.equal(c.nombre, 'SHELL')
    assert.equal(c.localidad, 'BONNEVILLE')
  })

  test('el número de factura no convierte al mismo emisor en dos empresas', () => {
    const a = limpiarConcepto('RECIBO HOLALUZ-CLIDOM, S.A. 2025VTA1685725/1')
    const b = limpiarConcepto('RECIBO HOLALUZ-CLIDOM, S.A. 2026VTA68084/1')
    assert.equal(a.nombre, b.nombre)
  })

  test('un concepto que es sólo un número de cuenta se conserva entero', () => {
    assert.equal(limpiarConcepto('1930-00010408').nombre, '1930-00010408')
  })

  test('normaliza acentos para que GAVÀ y GAVA sean lo mismo', () => {
    assert.equal(normalizar('Gavà'), 'GAVA')
  })

  test('colapsa espacios', () => {
    assert.equal(normalizar('  AIGÜES   DE  BARCELONA  '), 'AIGUES DE BARCELONA')
  })
})

describe('mismaPersona', () => {
  /** @type {Array<[string, string]>} */
  const iguales = [
    ['CARMEN AMPARO BENITEZ LARA', 'CARMEN B L'],
    ['CARMEN AMPARO BENITEZ LARA', 'CARMEN B. L.'],
    ['ELENA PILAR ROVIRA DALMAU', 'ELENA R D'],
    ['ELENA PILAR ROVIRA DALMAU', 'ELENA R. D.'],
    ['NURIA MORENO VEGA', 'NURIA M. V.'],
    ['ALBERT NADAL GUERRERO', 'ALBERT N G'],
  ]
  for (const [largo, corto] of iguales) {
    test(`${largo} = ${corto}`, () => {
      assert.equal(mismaPersona(largo, corto), true)
      assert.equal(mismaPersona(corto, largo), true, 'debe ser simétrica')
    })
  }

  /** @type {Array<[string, string, string]>} */
  const distintos = [
    ['CARMEN AMPARO BENITEZ LARA', 'CARMEN G P', 'iniciales que no casan'],
    ['ALBERT NADAL GUERRERO', 'RAMON N G', 'otro nombre de pila'],
    ['ELENA PILAR ROVIRA DALMAU', 'ELENA D R', 'orden invertido'],
    ['CARMEN BLANCO CAMPOS', 'CARMEN B L', 'la B casa pero la L no'],
    ['CARMEN AMPARO BENITEZ LARA', 'CARMEN BLANCO CAMPOS', 'dos nombres completos distintos'],
  ]
  for (const [a, b, porque] of distintos) {
    test(`${a} ≠ ${b} (${porque})`, () => {
      assert.equal(mismaPersona(a, b), false)
      assert.equal(mismaPersona(b, a), false)
    })
  }
})

describe('reconciliar', () => {
  test('funde las tres formas de una misma persona en una entidad', () => {
    const { entidades } = reconciliar([
      'CARMEN AMPARO BENITEZ LARA', 'CARMEN B L', 'CARMEN B. L.',
    ])
    assert.equal(entidades.length, 1)
    assert.equal(entidades[0].nombre, 'CARMEN AMPARO BENITEZ LARA')
    assert.equal(entidades[0].alias.length, 3)
    assert.equal(entidades[0].tipo, 'persona')
  })

  test('el nombre canónico es la forma completa aunque llegue la segunda', () => {
    const { entidades } = reconciliar(['CARMEN B L', 'CARMEN AMPARO BENITEZ LARA'])
    assert.equal(entidades[0].nombre, 'CARMEN AMPARO BENITEZ LARA')
  })

  test('funde las cinco caras de Amazon por regla', () => {
    const { entidades, categorias } = reconciliar([
      'WWW.AMAZON', 'AMZN MKTP ES', 'AMAZON', 'AMAZON.ES AMAZON.ES/AYU', 'WWW.AMAZON Z74R72GK4',
    ])
    const amazon = entidades.find((e) => e.nombre === 'Amazon')
    assert.ok(amazon, 'debería existir una entidad Amazon')
    assert.equal(amazon.alias.length, 5)
    assert.equal(categorias.get(amazon.id), 'compras')
  })

  test('no funde comercios distintos que comparten palabra', () => {
    const { entidades } = reconciliar(['CONDIS GAVA', 'CAPRABO BEGUES'])
    assert.equal(entidades.length, 2)
  })

  test('una persona suelta sin abreviatura no se marca como persona', () => {
    const { entidades } = reconciliar(['LULUKABARAKA, SL'])
    assert.equal(entidades[0].tipo, 'comercio')
  })

  test('lista vacía da lista vacía', () => {
    assert.deepEqual(reconciliar([]).entidades, [])
  })

  test('idDesde produce identificadores estables y legibles', () => {
    assert.equal(idDesde('Ajuntament de Gavà'), 'ajuntament-de-gava')
    assert.equal(idDesde('CARMEN B. L.'), 'carmen-b-l')
  })
})
