// @ts-check
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { buzonDesde, hacerMaleta, subir, bajar, desdeFichero, SinBuzon } from '../src/almacen/sincro.js'
import { cifrar, ContrasenaInvalida } from '../src/almacen/cifrado.js'
import worker from '../worker/src/index.js'

describe('buzón', () => {
  test('la misma contraseña da siempre el mismo buzón', async () => {
    assert.equal(await buzonDesde('secreta'), await buzonDesde('secreta'))
  })

  test('contraseñas distintas dan buzones distintos', async () => {
    assert.notEqual(await buzonDesde('secreta'), await buzonDesde('secretA'))
  })

  test('tiene la forma que el worker acepta', async () => {
    assert.match(await buzonDesde('lo que sea'), /^[a-f0-9]{32}$/)
  })

  test('el identificador no contiene la contraseña', async () => {
    const id = await buzonDesde('holaluz')
    assert.ok(!id.includes(Buffer.from('holaluz').toString('hex')))
  })
})

describe('maleta', () => {
  test('lleva los movimientos y la fecha de guardado', () => {
    const maleta = hacerMaleta([{ id: 'x' }], { hoy: '2026-09-26' })
    assert.equal(maleta.movimientos.length, 1)
    assert.equal(maleta.ajustes.hoy, '2026-09-26')
    assert.match(maleta.guardado, /^\d{4}-\d{2}-\d{2}T/)
  })
})

/**
 * El circuito entero contra el worker de verdad, con un KV de mentira: si el
 * contrato entre cliente y buzón se rompe, esto lo dice antes de desplegar.
 */
describe('ida y vuelta por el buzón', () => {
  const almacen = new Map()
  const BUZONES = {
    async get(k) { return almacen.has(k) ? almacen.get(k) : null },
    async put(k, v) { almacen.set(k, v) },
  }

  /** @param {Request} peticion */
  const atender = async (peticion) => worker.fetch(peticion, { BUZONES })

  test('lo que sube con una contraseña baja con esa contraseña', async () => {
    globalThis.fetch = (url, opciones) => atender(new Request(url, opciones))

    const maleta = hacerMaleta([{ id: 'a', importe: -73315, conceptoRaw: 'AIGUES DE BARCELONA' }])
    await subir('https://buzon.test', maleta, 'la buena')
    const vuelta = await bajar('https://buzon.test', 'la buena')
    assert.equal(vuelta.movimientos[0].conceptoRaw, 'AIGUES DE BARCELONA')
  })

  test('lo guardado en el buzón es ilegible', async () => {
    const guardado = [...almacen.values()][0]
    assert.ok(!guardado.includes('AIGUES'))
    assert.ok(!guardado.includes('73315'))
  })

  test('otra contraseña ni siquiera encuentra el buzón', async () => {
    globalThis.fetch = (url, opciones) => atender(new Request(url, opciones))
    await assert.rejects(() => bajar('https://buzon.test', 'la mala'), SinBuzon)
  })

  test('el buzón rechaza lo que no es un sobre', async () => {
    const respuesta = await atender(new Request(`https://buzon.test/${'a'.repeat(32)}`, {
      method: 'PUT', body: 'hola',
    }))
    assert.equal(respuesta.status, 400)
  })

  test('el buzón rechaza identificadores inventados', async () => {
    const respuesta = await atender(new Request('https://buzon.test/../etc/passwd'))
    assert.equal(respuesta.status, 400)
  })
})

/** El otro camino: el sobre viaja como fichero y se abre en el otro dispositivo. */
describe('ida y vuelta por fichero', () => {
  const sobreComoFichero = async (maleta, contrasena) =>
    new File([JSON.stringify(await cifrar(maleta, contrasena))], 'bajamar.bajamar')

  test('lo que se envía se abre con la misma contraseña', async () => {
    const fichero = await sobreComoFichero(hacerMaleta([{ id: 'a', importe: -4891 }]), 'la buena')
    const maleta = await desdeFichero(fichero, 'la buena')
    assert.equal(maleta.movimientos[0].importe, -4891)
  })

  test('con otra contraseña no se abre', async () => {
    const fichero = await sobreComoFichero(hacerMaleta([{ id: 'a' }]), 'la buena')
    await assert.rejects(() => desdeFichero(fichero, 'la mala'), ContrasenaInvalida)
  })
})
