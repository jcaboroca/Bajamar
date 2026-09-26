// @ts-check
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { cifrar, descifrar, ContrasenaInvalida } from '../src/almacen/cifrado.js'

const CLAVE = 'una contraseña larga de prueba'

describe('cifrado', () => {
  test('lo que se cifra se recupera igual', async () => {
    const original = { movimientos: [{ id: 'a', importe: -73315, concepto: 'AIGÜES' }] }
    const abierto = await descifrar(await cifrar(original, CLAVE), CLAVE)
    assert.deepEqual(abierto, original)
  })

  test('el sobre no contiene el texto en claro', async () => {
    const sobre = await cifrar({ concepto: 'HOLALUZ', importe: -8842 }, CLAVE)
    const serializado = JSON.stringify(sobre)
    assert.ok(!serializado.includes('HOLALUZ'))
    assert.ok(!serializado.includes('8842'))
  })

  test('otra contraseña no abre', async () => {
    const sobre = await cifrar({ saldo: 1 }, CLAVE)
    await assert.rejects(() => descifrar(sobre, 'otra cosa'), ContrasenaInvalida)
  })

  test('un byte manipulado invalida el mensaje entero', async () => {
    const sobre = await cifrar({ saldo: 100 }, CLAVE)
    const bytes = [...atob(sobre.datos)].map((c) => c.charCodeAt(0))
    bytes[0] ^= 1
    sobre.datos = btoa(String.fromCharCode(...bytes))
    await assert.rejects(() => descifrar(sobre, CLAVE), ContrasenaInvalida)
  })

  test('dos cifrados del mismo dato son distintos', async () => {
    const a = await cifrar({ saldo: 7 }, CLAVE)
    const b = await cifrar({ saldo: 7 }, CLAVE)
    assert.notEqual(a.datos, b.datos, 'el IV aleatorio debe cambiar el resultado')
    assert.notEqual(a.sal, b.sal)
  })

  test('sobrevive a un volumen realista de movimientos', async () => {
    const muchos = Array.from({ length: 1200 }, (_, i) => ({
      id: `cuenta:2026-01-01:${i}`, importe: -i * 37, concepto: `COMERCIO ${i} ÁÉÍÓÚ`,
    }))
    const abierto = await descifrar(await cifrar(muchos, CLAVE), CLAVE)
    assert.equal(abierto.length, 1200)
    assert.equal(abierto[1199].concepto, 'COMERCIO 1199 ÁÉÍÓÚ')
  })

  test('cifrar sin contraseña es un error, no un sobre abierto', async () => {
    await assert.rejects(() => cifrar({ a: 1 }, ''))
  })
})
