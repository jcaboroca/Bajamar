// @ts-check
import test, { describe } from 'node:test'
import assert from 'node:assert/strict'

import { hayVersionNueva, selloPublicado } from '../src/ui/actualizacion.js'

/** @param {{ ok?: boolean, cuerpo?: unknown, revienta?: boolean }} opciones */
function fetchFalso({ ok = true, cuerpo = { sello: 'abc' }, revienta = false }) {
  return async (/** @type {any} */ _url, /** @type {any} */ _opciones) => {
    if (revienta) throw new Error('sin red')
    return /** @type {any} */ ({ ok, json: async () => cuerpo })
  }
}

describe('saber si el código que corre ya no es el último', () => {
  test('el sello que hay publicado', async () => {
    assert.equal(await selloPublicado(fetchFalso({})), 'abc')
  })

  test('sin red no dice nada, porque avisar en falso es peor que callar', async () => {
    assert.equal(await selloPublicado(fetchFalso({ revienta: true })), null)
    assert.equal(await hayVersionNueva(fetchFalso({ revienta: true }), 'mio'), false)
  })

  test('un 404 o un fichero raro tampoco cuentan como versión nueva', async () => {
    assert.equal(await selloPublicado(fetchFalso({ ok: false })), null)
    assert.equal(await selloPublicado(fetchFalso({ cuerpo: { otra: 1 } })), null)
    assert.equal(await hayVersionNueva(fetchFalso({ cuerpo: {} }), 'mio'), false)
  })

  test('avisa sólo cuando el sello publicado es otro', async () => {
    assert.equal(await hayVersionNueva(fetchFalso({}), 'abc'), false)
    assert.equal(await hayVersionNueva(fetchFalso({}), 'viejo'), true)
  })
})
