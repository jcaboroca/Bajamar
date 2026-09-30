// @ts-check
import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { SELLO } from '../src/version.js'

const leer = (/** @type {string} */ ruta) => readFileSync(fileURLToPath(new URL(`../${ruta}`, import.meta.url)), 'utf8')

describe('el sello llega a los tres sitios que lo necesitan', () => {
  test('el fichero que se guarda en el aparato lleva el sello de hoy', () => {
    // Si se quedara con uno viejo, el navegador no vería nunca que hay versión
    // nueva: el script del service worker es lo único que no se sirve de caché.
    assert.match(leer('sw.js'), new RegExp(`const SELLO = '${SELLO}'`))
  })

  test('la lista de ficheros incluye el propio sello y la portada', () => {
    const { sello, ficheros } = JSON.parse(leer('version.json'))
    assert.equal(sello, SELLO)
    assert.ok(ficheros.includes('src/version.js'), 'sin él, aplicar la versión no la aplica')
    assert.ok(ficheros.includes('index.html'))
    assert.ok(ficheros.includes('src/ui/app.js'))
    assert.ok(ficheros.every((/** @type {string} */ f) => !f.includes('\\')), 'rutas de web, no de Windows')
  })
})
