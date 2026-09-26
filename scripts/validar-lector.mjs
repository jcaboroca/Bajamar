// @ts-check
/**
 * Comprobación del lector .xls contra los extractos reales, que no están en el
 * repositorio. No es una prueba automatizada: es la red que confirma que el
 * lector propio entiende lo que produce el banco.
 *
 *   node scripts/validar-lector.mjs ~/Downloads/cuenta.xls ~/Downloads/tarjeta.xls
 */

import { readFileSync } from 'node:fs'
import { leerLibro, texto } from '../src/importar/xls.js'

const rutas = process.argv.slice(2)
if (rutas.length === 0) {
  console.error('Uso: node scripts/validar-lector.mjs <fichero.xls> [otro.xls]')
  process.exit(1)
}

for (const ruta of rutas) {
  const buf = readFileSync(ruta)
  const datos = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  const rejilla = leerLibro(datos)
  console.log('='.repeat(72))
  console.log(ruta)
  console.log(`  filas: ${rejilla.length}  columnas: ${rejilla[0]?.length ?? 0}`)
  const hasta = Math.min(rejilla.length, 22)
  for (let f = 0; f < hasta; f += 1) {
    const celdas = (rejilla[f] ?? [])
      .map((c, i) => (c === null ? null : `[${i}]${typeof c === 'number' ? 'n' : 't'}:${JSON.stringify(c)}`))
      .filter(Boolean)
    if (celdas.length > 0) console.log(`  r${f}: ${celdas.join(' ')}`)
  }
  if (rejilla.length > hasta) {
    console.log(`  ... (${rejilla.length - hasta} filas más)`)
    const ultima = rejilla.length - 1
    console.log(`  r${ultima}: ${JSON.stringify(rejilla[ultima])}`)
  }
}
