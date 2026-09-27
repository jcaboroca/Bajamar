// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { oficioDe } from '../src/entidades/oficios.js'

describe('a qué se dedica, leído en el nombre', () => {
  test('las palabras del oficio bastan cuando nadie más contesta', () => {
    assert.equal(oficioDe('BAR MONTERREY'), 'restaurantes')
    assert.equal(oficioDe('ROMANPIZZA GAVA'), 'restaurantes')
    assert.equal(oficioDe('CAMPING LA VIORNA'), 'viajes')
    assert.equal(oficioDe('BENZINERA SOLSONA'), 'combustible')
    assert.equal(oficioDe('PEAGE AUTOROUTE ASF'), 'peajes')
    assert.equal(oficioDe('FARMACIA BEGUES BARCELONE'), 'cuidado')
    assert.equal(oficioDe('BABA SUPERMERCAT'), 'super')
    assert.equal(oficioDe('CLINICA VET BEGUES'), 'riggs')
  })

  test('un bar del área de servicio es cenar, no peaje', () => {
    assert.equal(oficioDe('AUCAT BAR VALLCARCA N'), 'restaurantes')
    assert.equal(oficioDe('ATMB'), 'peajes')
  })

  test('una palabra dentro de otra no cuenta', () => {
    assert.equal(oficioDe('BARCELONA POSITIVO'), null, 'BARCELONA no es un bar')
    assert.equal(oficioDe('BASARAMBLA'), null)
    assert.equal(oficioDe('CC BARNASUD'), null)
  })

  test('el dominio es la pista más floja y la última', () => {
    assert.equal(oficioDe('SEGUROPORDIAS.COM-+34917373810'), 'seguros')
    assert.equal(oficioDe('TERRADELCONGOST.COM'), 'compras')
  })

  test('lo que no dice nada se queda sin clasificar', () => {
    assert.equal(oficioDe('CRED OSIRIS'), null)
    assert.equal(oficioDe('SANTA LOCURA'), null)
  })
})
