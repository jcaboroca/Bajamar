// @ts-check
/**
 * Sella el service worker: descubre qué módulos hacen falta y pone una versión
 * derivada de su contenido.
 *
 * Las dos cosas se olvidaban a mano, y las dos fallan calladas. Si falta un
 * módulo en la lista, la aplicación abre bien con red y se rompe sin ella. Si
 * la versión no sube, el arreglo se publica y nadie llega a verlo nunca.
 *
 *   node scripts/sellar.mjs              reescribe sw.js
 *   node scripts/sellar.mjs --comprobar  sólo dice si está al día
 */

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Lo que no es un módulo y hay que guardar igual. */
const SUELTOS = [
  './',
  './index.html',
  './config.js',
  './manifest.webmanifest',
  './icono.svg',
  './src/ui/estilo.css',
]

const IMPORTA = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"](\.[^'"]+)['"]/g
const DINAMICO = /import\(\s*['"](\.[^'"]+)['"]\s*\)/g

/**
 * Todos los módulos alcanzables desde la entrada, en orden de descubrimiento.
 * @param {string} entrada  ruta relativa a la raíz
 * @returns {string[]}
 */
function modulosDesde(entrada) {
  const vistos = new Set()
  const cola = [entrada]
  while (cola.length > 0) {
    const actual = cola.shift()
    if (actual === undefined || vistos.has(actual)) continue
    vistos.add(actual)
    const codigo = readFileSync(join(RAIZ, actual), 'utf8')
    for (const patron of [IMPORTA, DINAMICO]) {
      patron.lastIndex = 0
      let m
      while ((m = patron.exec(codigo)) !== null) {
        cola.push(relative(RAIZ, resolve(dirname(join(RAIZ, actual)), m[1])))
      }
    }
  }
  return [...vistos]
}

function programa() {
  const html = readFileSync(join(RAIZ, 'index.html'), 'utf8')
  const entrada = /<script[^>]*type="module"[^>]*src="([^"]+)"/.exec(html)
  if (entrada === null) throw new Error('index.html no tiene un módulo de entrada')
  const modulos = modulosDesde(entrada[1]).sort().map((r) => `./${r}`)
  // config.js está en las dos listas: es un módulo y además se carga aparte.
  return [...new Set([...SUELTOS, ...modulos])]
}

/**
 * La versión es el contenido, no un número que alguien recuerda subir.
 * @param {string[]} lista
 */
function sello(lista) {
  const hash = createHash('sha256')
  for (const url of lista) {
    if (url === './') continue
    hash.update(url)
    hash.update(readFileSync(join(RAIZ, url.slice(2))))
  }
  return `bajamar-${hash.digest('hex').slice(0, 10)}`
}

function sellado() {
  const lista = programa()
  const sw = readFileSync(join(RAIZ, 'sw.js'), 'utf8')
  const conLista = sw.replace(
    /const PROGRAMA = \[[\s\S]*?\n\]/,
    `const PROGRAMA = [\n${lista.map((u) => `  '${u}',`).join('\n')}\n]`,
  )
  // El sello se calcula sobre los ficheros, no sobre sw.js: si se incluyera a
  // sí mismo nunca podría cuadrar consigo mismo.
  return conLista.replace(/const CAU = '[^']*'/, `const CAU = '${sello(lista)}'`)
}

const sw = readFileSync(join(RAIZ, 'sw.js'), 'utf8')
const nuevo = sellado()

if (process.argv.includes('--comprobar')) {
  if (sw === nuevo) {
    console.log('sw.js está sellado.')
    process.exit(0)
  }
  console.error('sw.js está sin sellar. Corre: npm run sellar')
  process.exit(1)
}

if (sw === nuevo) console.log('sw.js ya estaba sellado.')
else {
  writeFileSync(join(RAIZ, 'sw.js'), nuevo)
  console.log(`sw.js sellado: ${/const CAU = '([^']*)'/.exec(nuevo)?.[1]}`)
}
