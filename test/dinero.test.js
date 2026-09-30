// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  desdeFloat, formatEuros, formatEurosRedondo, mediana, parseImporte, sumar,
} from '../src/dominio/dinero.js'

describe('parseImporte', () => {
  test('locale español con miles y decimales', () => {
    assert.equal(parseImporte('1.234,56'), 123456)
  })
  test('negativo', () => {
    assert.equal(parseImporte('-1.234,56'), -123456)
  })
  test('sin miles', () => {
    assert.equal(parseImporte('161,32'), 16132)
  })
  test('cero', () => {
    assert.equal(parseImporte('0,00'), 0)
  })
  test('con moneda y espacios sobrantes', () => {
    assert.equal(parseImporte('  3.700,00 EUR '), 370000)
  })
  test('el total declarado de la tarjeta', () => {
    assert.equal(parseImporte('2.163,86 EUR'), 216386)
  })
  test('texto no numérico lanza', () => {
    assert.throws(() => parseImporte('pendiente'), RangeError)
  })
  test('cadena vacía lanza', () => {
    assert.throws(() => parseImporte(''), RangeError)
  })
})

describe('desdeFloat', () => {
  test('redondea el error binario', () => {
    // 2839.15 * 100 === 283914.99999999994
    assert.equal(desdeFloat(2839.15), 283915)
  })
  test('negativo del extracto', () => {
    assert.equal(desdeFloat(-582.37), -58237)
  })
  test('cero', () => {
    assert.equal(desdeFloat(0), 0)
  })
  test('no finito lanza', () => {
    assert.throws(() => desdeFloat(Number.NaN), RangeError)
  })
})

describe('formatEuros', () => {
  test('miles y decimales', () => {
    assert.equal(formatEuros(123456), '1.234,56 €')
  })
  test('negativo', () => {
    assert.equal(formatEuros(-45987), '-459,87 €')
  })
  test('signo explícito cuando se pide', () => {
    assert.equal(formatEuros(8900, { signo: true }), '+89,00 €')
  })
  test('redondo para titulares', () => {
    assert.equal(formatEurosRedondo(386029), '3.860 €')
  })
})

describe('sumar', () => {
  test('la reconciliación de la VISA cuadra al céntimo', () => {
    const cuotas = [37985, 18545, 18545, 16132, 16132, 16132]
    assert.equal(sumar(...cuotas), 123471)
  })
  test('sin argumentos da cero', () => {
    assert.equal(sumar(), 0)
  })
})

describe('mediana', () => {
  test('impar', () => {
    assert.equal(mediana([5000, 5500, 7000]), 5500)
  })
  test('par promedia los centrales', () => {
    assert.equal(mediana([5000, 5500, 6000, 7000]), 5750)
  })
  test('resiste un valor excepcional', () => {
    // Doggy Dog: 50, 55, 70. La media diría 58,33; la mediana dice 55.
    assert.equal(mediana([5000, 5500, 7000]), 5500)
  })
  test('serie vacía da cero', () => {
    assert.equal(mediana([]), 0)
  })
})

test('el cero no lleva signo, venga de donde venga', () => {
  assert.equal(formatEuros(-0), '0,00 €')
  assert.equal(formatEurosRedondo(-40), '0 €', 'cuarenta céntimos negativos redondean a cero, no a «-0»')
})
