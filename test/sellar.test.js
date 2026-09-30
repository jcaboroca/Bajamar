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

describe('sin conexión arranca', () => {
  test('todo lo que la app importa está en la lista de lo que se guarda', () => {
    // Basta un fichero fuera de la lista para que, sin red, no arranque nada.
    const { ficheros } = JSON.parse(leer('version.json'))
    const guardados = new Set(ficheros)
    const vistos = new Set()
    const pendientes = ['src/ui/app.js']
    while (pendientes.length > 0) {
      const ruta = /** @type {string} */ (pendientes.pop())
      if (vistos.has(ruta)) continue
      vistos.add(ruta)
      for (const [, destino] of leer(ruta).matchAll(/^\s*(?:import|export)[^'"]*from\s+'([^']+)'/gm)) {
        const url = new URL(destino, `http://x/${ruta}`)
        pendientes.push(url.pathname.slice(1))
      }
    }
    const faltan = [...vistos].filter((r) => !guardados.has(r))
    assert.deepEqual(faltan, [])
  })
})
