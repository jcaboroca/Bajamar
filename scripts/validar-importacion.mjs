// @ts-check
/**
 * Contrasta los parsers contra los extractos reales, que no viven en el
 * repositorio. Comprueba los invariantes que conocemos del análisis previo.
 *
 *   node scripts/validar-importacion.mjs ~/Downloads/cuenta.xls ~/Downloads/tarjeta.xls
 */

import { readFileSync } from 'node:fs'
import { formatEuros } from '../src/dominio/dinero.js'
import { importarXls } from '../src/importar/sabadell.js'

const rutas = process.argv.slice(2)
if (rutas.length === 0) {
  console.error('Uso: node scripts/validar-importacion.mjs <fichero.xls>...')
  process.exit(1)
}

let fallos = 0
/**
 * @param {string} etiqueta
 * @param {unknown} obtenido
 * @param {unknown} esperado
 */
function comprobar(etiqueta, obtenido, esperado) {
  const bien = obtenido === esperado
  if (!bien) fallos += 1
  console.log(`  ${bien ? '✓' : '✗'} ${etiqueta}: ${obtenido}${bien ? '' : `   (esperado ${esperado})`}`)
}

for (const ruta of rutas) {
  const buf = readFileSync(ruta)
  const { movimientos, avisos, meta } = importarXls(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  )
  console.log('='.repeat(72))
  console.log(`${ruta}\n  plantilla: ${meta.tipo}`)

  const fechas = movimientos.map((m) => m.fecha).sort()
  const gastos = movimientos.filter((m) => m.importe < 0)
  const ingresos = movimientos.filter((m) => m.importe > 0)
  const suma = movimientos.reduce((t, m) => t + m.importe, 0)

  if (meta.tipo === 'cuenta') {
    comprobar('movimientos', movimientos.length, 1127)
    comprobar('primera fecha', fechas[0], '2025-01-02')
    comprobar('última fecha', fechas[fechas.length - 1], '2026-09-28')
    comprobar('gastos', gastos.length, 1025)
    comprobar('ingresos', ingresos.length, 102)
    const distintas = movimientos.filter((m) => m.fecha !== m.fechaValor).length
    comprobar('fecha valor distinta de la operativa', distintas, 703)
    const ids = new Set(movimientos.map((m) => m.id))
    comprobar('identificadores únicos', ids.size, movimientos.length)
    const ultimo = movimientos[movimientos.length - 1]
    comprobar('saldo más antiguo', formatEuros(ultimo.saldo ?? 0), '5.477,13 €')
    const fracc = movimientos.filter((m) => m.fraccionado)
    console.log(`  · fraccionamientos detectados: ${fracc.length}`)
  } else {
    comprobar('cuotas listadas', movimientos.length, 12)
    comprobar('suma de las cuotas', formatEuros(suma), '-726,62 €')
    comprobar('todas son cargos', gastos.length, movimientos.length)
    comprobar('todas marcadas como fraccionadas', movimientos.filter((m) => m.fraccionado).length, 12)
    comprobar('periodo del extracto', meta.periodo, '2026-09')
    comprobar('total declarado', formatEuros(Number(meta.totalDeclarado)), '2.163,86 €')
    comprobar('saldo dispuesto', formatEuros(Number(meta.saldoDispuesto)), '1.218,75 €')
    // Filtrar por "IMPUESTOS" a secas se traga "PAGO DE IMPUESTOS AEAT", que es
    // otro cargo distinto. El fraccionamiento del IBI es el del ayuntamiento.
    const impuestos = movimientos.filter((m) => m.conceptoRaw.startsWith('IMPUESTOS AJ. GAVA'))
    comprobar('cuotas del IBI de Gavà', impuestos.length, 3)
    comprobar(
      'suman la cuota mensual de la VISA',
      formatEuros(impuestos.reduce((t, m) => t + m.importe, 0)),
      '-185,45 €',
    )
  }

  console.log(`  · rango ${fechas[0]} → ${fechas[fechas.length - 1]}`)
  console.log(`  · suma total ${formatEuros(suma)}`)
  if (avisos.length > 0) {
    console.log(`  · avisos (${avisos.length}):`)
    for (const a of avisos.slice(0, 5)) console.log(`      ${a}`)
  }
}

console.log('='.repeat(72))
console.log(fallos === 0 ? 'Todos los invariantes cuadran.' : `${fallos} invariante(s) sin cuadrar.`)
process.exit(fallos === 0 ? 0 : 1)
