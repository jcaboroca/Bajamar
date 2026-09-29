// Escribe un sello que cambia cuando cambia el código. La app lo compara con el
// que hay publicado para saber que la que está corriendo ya no es la última.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const raiz = fileURLToPath(new URL('..', import.meta.url))
const generado = join(raiz, 'src', 'version.js')

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

const suma = createHash('sha1')
for (const f of [...ficheros(join(raiz, 'src')), join(raiz, 'index.html')].sort()) {
  suma.update(readFileSync(f))
}
const sello = suma.digest('hex').slice(0, 12)

writeFileSync(generado, `// @ts-check\n// Lo escribe scripts/sellar.mjs. No se edita a mano.\nexport const SELLO = '${sello}'\n`)
writeFileSync(join(raiz, 'version.json'), `{ "sello": "${sello}" }\n`)
