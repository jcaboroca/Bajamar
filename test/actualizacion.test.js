// @ts-check
import test, { describe } from 'node:test'
import assert from 'node:assert/strict'

import { hayVersionNueva, publicado, refrescar, selloPublicado } from '../src/ui/actualizacion.js'

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

describe('aplicar la versión nueva de verdad', () => {
  test('pide cada fichero saltándose la caché del navegador', async () => {
    /** @type {[string, string][]} */
    const pedidos = []
    const traer = async (/** @type {any} */ url, /** @type {any} */ o) => {
      pedidos.push([url, o?.cache])
      return /** @type {any} */ ({ ok: true, json: async () => ({}) })
    }
    await refrescar(traer, ['index.html', 'src/version.js'])
    assert.deepEqual(pedidos, [['index.html', 'reload'], ['src/version.js', 'reload']])
  })

  test('un fichero que no se puede pedir no impide aplicar el resto', async () => {
    const traer = async (/** @type {any} */ url) => {
      if (url === 'malo.js') throw new Error('sin red')
      return /** @type {any} */ ({ ok: true })
    }
    await refrescar(traer, ['malo.js', 'bueno.js'])
  })

  test('la lista de ficheros viaja con el sello', async () => {
    const con = fetchFalso({ cuerpo: { sello: 'abc', ficheros: ['src/version.js'] } })
    assert.deepEqual(await publicado(con), { sello: 'abc', ficheros: ['src/version.js'] })
    // Un version.json viejo, sin lista, no puede reventar el arranque.
    assert.deepEqual(await publicado(fetchFalso({})), { sello: 'abc', ficheros: [] })
  })
})
