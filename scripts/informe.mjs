// @ts-check
/**
 * Informe en texto del análisis completo sobre los extractos reales.
 * Sirve para contrastar lo que calcula la aplicación con lo que ya sabemos.
 *
 *   node scripts/informe.mjs ~/Downloads/cuenta.xls ~/Downloads/tarjeta.xls
 */

import { readFileSync } from 'node:fs'
import { formatEuros, formatEurosRedondo } from '../src/dominio/dinero.js'
import { fechaLarga } from '../src/dominio/tipos.js'
import { importarXls } from '../src/importar/sabadell.js'
import { construirEstado, totalesPorCategoria } from '../src/estado.js'

const rutas = process.argv.slice(2)
const HOY = process.env.HOY ?? '2026-09-28'

/** @type {import('../src/dominio/tipos.js').Movimiento[]} */
const todos = []
for (const ruta of rutas) {
  const buf = readFileSync(ruta)
  const { movimientos, avisos } = importarXls(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  todos.push(...movimientos)
  for (const a of avisos) console.log(`aviso · ${a}`)
}

const e = construirEstado(todos, { hoy: HOY })

const linea = (t) => console.log(`\n${'─'.repeat(70)}\n${t}\n${'─'.repeat(70)}`)

linea('SITUACIÓN')
console.log(`  saldo a ${fechaLarga(HOY)}: ${formatEuros(e.saldoInicial)}`)
console.log(`  movimientos: ${e.movimientos.length}   entidades: ${e.entidades.length}`)
console.log(`  gasto ordinario: ${formatEuros(e.ritmo.porMes)}/mes (mediana de ${e.ritmo.meses} meses)`)
console.log(`  pendiente en la tarjeta: ${formatEuros(e.pendienteTarjeta)}`)

linea('BAJAMAR')
const { suelo, saldoFinal, hasta } = e.proyeccion
console.log(`  punto más bajo: ${formatEurosRedondo(suelo.saldo)} el ${fechaLarga(suelo.fecha)}`)
console.log(`  saldo al ${fechaLarga(hasta)}: ${formatEurosRedondo(saldoFinal)}`)

linea('LO QUE VIENE')
for (const ev of e.proyeccion.eventos) {
  const marca = ev.seguro ? '●' : '○'
  console.log(`  ${marca} ${ev.fecha}  ${formatEuros(ev.importe).padStart(12)}  ${ev.nombre}`)
}

linea(`COMPROMISOS DETECTADOS (${e.compromisos.length})`)
for (const c of e.compromisos) {
  const sello = c.estado === 'retrasado' ? ' ← no ha llegado' : ''
  console.log(
    `  ${c.nombre.padEnd(32).slice(0, 32)} ${c.periodicidad.padEnd(11)} ` +
    `${formatEuros(c.importeEsperado).padStart(11)}  ×${String(c.observaciones).padStart(2)}  ` +
    `próx. ${c.proximaPrevista}${sello}`,
  )
}

if (e.dudosos.length > 0) {
  linea(`PREGUNTAS (${e.dudosos.length}) — pocas apariciones, no deduzco el ritmo`)
  for (const d of e.dudosos) {
    console.log(`  ${d.nombre.padEnd(36).slice(0, 36)} ${formatEuros(d.importe).padStart(11)}  última hace ${d.meses} meses (${d.fecha})`)
  }
}

linea('GASTO POR CATEGORÍA (últimos 12 meses)')
const desde = '2025-10-01'
const tot = totalesPorCategoria(e.movimientos, e.categorias, { desde })
const suma = tot.reduce((t, c) => t + c.total, 0)
for (const c of tot) {
  console.log(`  ${c.nombre.padEnd(22)} ${formatEuros(c.total).padStart(12)}  ${String(c.cuantos).padStart(4)} mov.  ${formatEuros(Math.round(c.total / 12)).padStart(10)}/mes`)
}
console.log(`  ${'TOTAL'.padEnd(22)} ${formatEuros(suma).padStart(12)}`)

linea('LO MÁS GORDO SIN CLASIFICAR (últimos 12 meses)')
/** @type {Map<string, { total: number, cuantos: number }>} */
const sueltos = new Map()
for (const m of e.movimientos) {
  if (m.fecha < desde || m.importe >= 0 || m.origen === 'tarjeta') continue
  if (!m.entidadId || (e.categorias.get(m.entidadId) ?? 'otros') !== 'otros') continue
  const previo = sueltos.get(m.entidadId) ?? { total: 0, cuantos: 0 }
  sueltos.set(m.entidadId, { total: previo.total + m.importe, cuantos: previo.cuantos + 1 })
}
const top = [...sueltos.entries()].sort((a, b) => a[1].total - b[1].total).slice(0, 30)
for (const [id, v] of top) {
  console.log(`  ${(e.nombres.get(id) ?? id).padEnd(40).slice(0, 40)} ${formatEuros(v.total).padStart(12)}  ${String(v.cuantos).padStart(3)} mov.`)
}

linea('COMPROBACIONES CONTRA LO QUE YA SABEMOS')
const marisol = e.entidades.find((x) => x.nombre.startsWith('MARIA SOLEDAD'))
if (marisol) {
  const pagos = e.movimientos.filter((m) => m.entidadId === marisol.id)
  const total = pagos.reduce((t, m) => t + m.importe, 0)
  const ok = pagos.length === 24 && total === -104700
  console.log(`  ${ok ? '✓' : '✗'} Marisol: ${pagos.length} pagos, ${formatEuros(total)} (esperado 24 y -1.047,00 €)`)
  console.log(`      alias fundidos: ${marisol.alias.join(' · ')}`)
} else {
  console.log('  ✗ no se encontró a Marisol')
}
