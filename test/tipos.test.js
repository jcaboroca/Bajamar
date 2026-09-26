// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  diasEntre, fechaDesdeEs, fechaDesdeEsSinAnio, fechaLarga, hoyIso,
  mesDe, sumarMeses, ultimoDiaDelMes,
} from '../src/dominio/tipos.js'

describe('fechaDesdeEs', () => {
  test('convierte a ISO', () => {
    assert.equal(fechaDesdeEs('28/09/2026'), '2026-09-28')
  })
  test('rellena con ceros', () => {
    assert.equal(fechaDesdeEs('2/1/2025'), '2025-01-02')
  })
  test('acepta hora detrás y la ignora', () => {
    assert.equal(fechaDesdeEs('26/09/2026 9:19:40'), '2026-09-26')
  })
  test('29 de febrero bisiesto es válido', () => {
    assert.equal(fechaDesdeEs('29/02/2028'), '2028-02-29')
  })
  test('29 de febrero no bisiesto lanza', () => {
    assert.throws(() => fechaDesdeEs('29/02/2026'), RangeError)
  })
  test('mes 13 lanza', () => {
    assert.throws(() => fechaDesdeEs('01/13/2026'), RangeError)
  })
  test('31 de abril lanza', () => {
    assert.throws(() => fechaDesdeEs('31/04/2026'), RangeError)
  })
  test('basura lanza', () => {
    assert.throws(() => fechaDesdeEs('pendiente'), RangeError)
  })
})

describe('fechaDesdeEsSinAnio', () => {
  test('mismo mes que el extracto', () => {
    assert.equal(fechaDesdeEsSinAnio('22/09', 2026, 9), '2026-09-22')
  })
  test('mes anterior, mismo año', () => {
    assert.equal(fechaDesdeEsSinAnio('01/07', 2026, 9), '2026-07-01')
  })
  test('mes posterior al extracto es del año anterior', () => {
    assert.equal(fechaDesdeEsSinAnio('15/12', 2026, 2), '2025-12-15')
  })
  test('sin barra lanza', () => {
    assert.throws(() => fechaDesdeEsSinAnio('2209', 2026, 9), RangeError)
  })
})

describe('sumarMeses', () => {
  test('avanza dentro del año', () => {
    assert.equal(sumarMeses('2026-09-28', 1), '2026-10-28')
  })
  test('cruza el año', () => {
    assert.equal(sumarMeses('2026-12-01', 1), '2027-01-01')
  })
  test('recorta el día al último del mes destino', () => {
    assert.equal(sumarMeses('2026-01-31', 1), '2026-02-28')
  })
  test('retrocede', () => {
    assert.equal(sumarMeses('2026-01-15', -1), '2025-12-15')
  })
  test('doce meses es un año exacto', () => {
    assert.equal(sumarMeses('2026-07-01', 12), '2027-07-01')
  })
})

describe('diasEntre', () => {
  test('días dentro del mes', () => {
    assert.equal(diasEntre('2026-10-01', '2026-10-05'), 4)
  })
  test('cruza cambio de hora y sigue siendo entero', () => {
    assert.equal(diasEntre('2026-10-24', '2026-10-27'), 3)
  })
  test('negativo hacia atrás', () => {
    assert.equal(diasEntre('2026-10-05', '2026-10-01'), -4)
  })
})

describe('utilidades', () => {
  test('mesDe', () => {
    assert.equal(mesDe('2026-09-28'), '2026-09')
  })
  test('ultimoDiaDelMes en febrero bisiesto', () => {
    assert.equal(ultimoDiaDelMes('2028-02-10'), '2028-02-29')
  })
  test('ultimoDiaDelMes en abril', () => {
    assert.equal(ultimoDiaDelMes('2026-04-01'), '2026-04-30')
  })
  test('fechaLarga', () => {
    assert.equal(fechaLarga('2026-10-05'), '5 de octubre')
  })
  test('hoyIso con reloj fijo', () => {
    assert.equal(hoyIso(new Date(2026, 8, 28)), '2026-09-28')
  })
})
