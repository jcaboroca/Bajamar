// Monta el buzón de Cloudflare de una vez: crea el almacén, lo apunta en la
// configuración del worker, lo despliega y deja la dirección en config.js.
// A mano son cuatro pasos y en uno hay que copiar un identificador sin
// equivocarse, que es justo donde esto se tuerce.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const WORKER = join(RAIZ, 'worker')
const TOML = join(WORKER, 'wrangler.toml')
const CONFIG = join(RAIZ, 'config.js')

/** @param {string[]} argumentos */
function wrangler(argumentos) {
  // --yes para que npx no se quede esperando el "¿instalo wrangler?".
  const salida = spawnSync('npx', ['--yes', 'wrangler@4', ...argumentos], {
    cwd: WORKER,
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'inherit'],
  })
  if (salida.status !== 0) {
    console.error(`\nFalló: wrangler ${argumentos.join(' ')}`)
    process.exit(1)
  }
  process.stdout.write(salida.stdout)
  return salida.stdout
}

const toml = readFileSync(TOML, 'utf8')

if (toml.includes('id = "PENDIENTE"')) {
  console.log('→ Creando el almacén…')
  const creado = wrangler(['kv', 'namespace', 'create', 'BUZONES'])
  const id = creado.match(/id\s*=\s*"([0-9a-f]{32})"/)?.[1]
  if (!id) {
    console.error('\nNo he sabido leer el identificador del almacén. Pégalo a mano en worker/wrangler.toml.')
    process.exit(1)
  }
  writeFileSync(TOML, toml.replace('id = "PENDIENTE"', `id = "${id}"`))
  console.log(`→ Almacén ${id} anotado en worker/wrangler.toml`)
} else {
  console.log('→ El almacén ya estaba creado.')
}

console.log('→ Desplegando el buzón…')
const desplegado = wrangler(['deploy'])
const direccion = desplegado.match(/https:\/\/[a-z0-9.-]*workers\.dev/)?.[0]

if (!direccion) {
  console.error('\nDesplegado, pero no he visto la dirección. Cópiala arriba y pégala en config.js.')
  process.exit(1)
}

const config = readFileSync(CONFIG, 'utf8')
writeFileSync(CONFIG, config.replace(/export const BUZON = '[^']*'/, `export const BUZON = '${direccion}'`))

console.log(`
Listo. El buzón vive en ${direccion} y ya está en config.js.

Solo queda publicarlo para que el móvil lo use:
  git add config.js worker/wrangler.toml && git commit -m "Buzón" && git push
`)
