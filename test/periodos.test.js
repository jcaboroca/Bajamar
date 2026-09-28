// @ts-check
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { cortesDeNomina, diasQueDura, periodoDe, periodosEntre } from '../src/analisis/periodos.js'

/** @param {string[]} fechas */
const cobros = (fechas) => fechas.map((fecha) => ({ fecha }))

describe('el mes va de nómina a nómina', () => {
  const cortes = ['2026-07-25', '2026-08-25', '2026-09-25']
  const periodos = periodosEntre({ cortes, desde: '2026-07-25', hasta: '2026-10-20' })

  test('empieza el día de la nómina y acaba el día antes de la siguiente', () => {
    assert.deepEqual(periodos.map((p) => [p.id, p.desde, p.hasta]), [
      ['2026-08', '2026-07-25', '2026-08-24'],
      ['2026-09', '2026-08-25', '2026-09-24'],
      ['2026-10', '2026-09-25', '2026-10-20'],
    ])
  })

  test('se llama como el mes en que acaba', () => {
    // El que va del 25 de agosto al 24 de septiembre es septiembre, que es
    // como lo llama uno al hablar.
    assert.equal(periodoDe(periodos, '2026-09-01')?.id, '2026-09')
    // El 24 de agosto es el último día del periodo que se llama agosto.
    assert.equal(periodoDe(periodos, '2026-08-24')?.id, '2026-08')
    assert.equal(periodoDe(periodos, '2026-09-24')?.id, '2026-09')
  })

  test('el día que entra la nómina ya es del mes que abre', () => {
    // El 25 cierra agosto y abre septiembre: es de septiembre.
    assert.equal(periodoDe(periodos, '2026-08-24')?.id, '2026-08')
    assert.equal(periodoDe(periodos, '2026-08-25')?.id, '2026-09')
  })

  test('ningún día cae en dos periodos ni se queda fuera', () => {
    for (let i = 0; i < periodos.length - 1; i += 1) {
      const fin = periodos[i].hasta
      const siguiente = periodos[i + 1].desde
      const [a, m, d] = fin.split('-').map(Number)
      const diaDespues = new Date(Date.UTC(a, m - 1, d + 1)).toISOString().slice(0, 10)
      assert.equal(diaDespues, siguiente, `hueco o solape entre ${fin} y ${siguiente}`)
    }
  })

  test('el último no está completo: todavía no tiene cierre', () => {
    assert.equal(periodos[periodos.length - 1].completo, false)
    assert.equal(periodos[0].completo, true)
  })
})

describe('la nómina no cae siempre el mismo día', () => {
  test('cobrar el 23 acorta ese periodo y no descoloca los siguientes', () => {
    const periodos = periodosEntre({
      cortes: ['2026-07-25', '2026-08-23', '2026-09-25'],
      desde: '2026-07-25',
      hasta: '2026-09-30',
    })
    const agosto = periodos.find((p) => p.id === '2026-08')
    const septiembre = periodos.find((p) => p.id === '2026-09')
    assert.equal(agosto?.hasta, '2026-08-22')
    assert.equal(diasQueDura(agosto), 29)
    assert.equal(septiembre?.desde, '2026-08-23')
    assert.equal(diasQueDura(septiembre), 33)
  })

  test('un mes sin nómina alarga el periodo, no lo parte', () => {
    const periodos = periodosEntre({
      cortes: ['2026-07-25', '2026-09-25'],
      desde: '2026-07-25',
      hasta: '2026-09-30',
    })
    const largo = periodos.find((p) => p.desde === '2026-07-25')
    assert.equal(largo?.hasta, '2026-09-24')
    assert.equal(diasQueDura(largo), 62)
  })
})

describe('lo que no se puede dar por supuesto', () => {
  test('sin nómina reconocida se cuenta por meses naturales, y se sabe', () => {
    const periodos = periodosEntre({ cortes: [], desde: '2026-08-10', hasta: '2026-10-05' })
    assert.deepEqual(periodos.map((p) => [p.id, p.desde, p.hasta]), [
      ['2026-08', '2026-08-10', '2026-08-31'],
      ['2026-09', '2026-09-01', '2026-09-30'],
      ['2026-10', '2026-10-01', '2026-10-05'],
    ])
    assert.ok(periodos.every((p) => p.natural))
    // Los de los bordes están cortados y lo dicen.
    assert.equal(periodos[0].completo, false)
    assert.equal(periodos[1].completo, true)
  })

  test('lo anterior a la primera nómina sale marcado como incompleto', () => {
    const periodos = periodosEntre({
      cortes: ['2026-08-25'], desde: '2026-08-01', hasta: '2026-09-10',
    })
    assert.equal(periodos[0].desde, '2026-08-01')
    assert.equal(periodos[0].hasta, '2026-08-24')
    assert.equal(periodos[0].completo, false)
  })

  test('dos periodos que acaban el mismo mes no comparten identidad', () => {
    // Un plan guardado para uno aparecería en el otro.
    const periodos = periodosEntre({
      cortes: ['2026-09-01', '2026-09-30'], desde: '2026-09-01', hasta: '2026-10-20',
    })
    assert.equal(new Set(periodos.map((p) => p.id)).size, periodos.length)
  })
})

describe('qué nómina corta', () => {
  test('una paga extra no parte el mes en dos', () => {
    // Junio con nómina el 25 y paga extra el 30: sigue siendo un solo periodo.
    const cortes = cortesDeNomina({
      cobradas: cobros(['2026-05-25', '2026-06-25', '2026-06-30']),
      previstas: cobros(['2026-07-25']),
    })
    assert.deepEqual(cortes, ['2026-05-25', '2026-06-25', '2026-07-25'])
  })

  test('cuando hay dos en el mismo mes manda la primera', () => {
    const cortes = cortesDeNomina({ cobradas: cobros(['2026-06-30', '2026-06-25']), previstas: [] })
    assert.deepEqual(cortes, ['2026-06-25'])
  })

  test('las previstas se juntan con las cobradas, en orden', () => {
    const cortes = cortesDeNomina({
      cobradas: cobros(['2026-08-25']),
      previstas: cobros(['2026-09-25', '2026-10-25']),
    })
    assert.deepEqual(cortes, ['2026-08-25', '2026-09-25', '2026-10-25'])
  })
})
