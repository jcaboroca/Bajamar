// Escribe un sello que cambia cuando cambia el código. La app lo compara con el
// que hay publicado para saber que la que está corriendo ya no es la última.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative, sep } from 'node:path'

const raiz = fileURLToPath(new URL('..', import.meta.url))
const generado = join(raiz, 'src', 'version.js')
const servidor = join(raiz, 'sw.js')
const SIN_SELLAR = "const SELLO = 'sin-sellar'"

// El sello acaba dentro del propio sw.js, así que para pesarlo se mira sin él:
// si no, cambiarlo cambiaría el hash y no pararía nunca.
const servidorDesnudo = () => readFileSync(servidor, 'utf8').replace(/const SELLO = '[^']*'/, SIN_SELLAR)

/** @param {string} dir */
function ficheros(dir) {
  /** @type {string[]} */
  const salida = []
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name)
    if (entrada.isDirectory()) salida.push(...ficheros(ruta))
    // El propio sello queda fuera, o cambiarlo cambiaría el hash sin parar.
    else if (ruta !== generado) salida.push(ruta)
  }
  return salida
}

const lista = [
  ...ficheros(join(raiz, 'src')),
  join(raiz, 'index.html'),
  join(raiz, 'manifest.webmanifest'),
].sort()
const suma = createHash('sha1')
for (const f of lista) suma.update(readFileSync(f))
suma.update(servidorDesnudo())
const sello = suma.digest('hex').slice(0, 12)

// La lista viaja con el sello porque al aplicar la versión hay que pedir cada
// fichero a la fuerza: el navegador los guarda diez minutos y, sin eso, la
// recarga vuelve a arrancar el código viejo y el aviso reaparece sin fin.
// El propio sello entra aquí aunque no entre en el hash: es el primero que
// tiene que llegar nuevo.
const rutas = [...lista.map((f) => relative(raiz, f)), join('src', 'version.js')]
  .map((r) => r.split(sep).join('/'))
  .sort()

writeFileSync(generado, `// @ts-check\n// Lo escribe scripts/sellar.mjs. No se edita a mano.\nexport const SELLO = '${sello}'\n`)
writeFileSync(servidor, servidorDesnudo().replace(SIN_SELLAR, `const SELLO = '${sello}'`))
writeFileSync(join(raiz, 'version.json'), `${JSON.stringify({ sello, ficheros: rutas })}\n`)
