// @ts-check
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { buzonDesde, hacerMaleta, subir, bajar, desdeFichero, SinBuzon } from '../src/almacen/sincro.js'
import { fundir } from '../src/almacen/db.js'
import { cifrar, ContrasenaInvalida } from '../src/almacen/cifrado.js'
import worker from '../worker/src/index.js'

describe('buzón', () => {
  test('la misma contraseña da siempre el mismo buzón', async () => {
    assert.equal(await buzonDesde('secreta'), await buzonDesde('secreta'))
  })

  test('contraseñas distintas dan buzones distintos', async () => {
    assert.notEqual(await buzonDesde('secreta'), await buzonDesde('secretA'))
  })

  test('tiene la forma que el worker acepta', async () => {
    assert.match(await buzonDesde('lo que sea'), /^[a-f0-9]{32}$/)
  })

  test('el identificador no contiene la contraseña', async () => {
    const id = await buzonDesde('holaluz')
    assert.ok(!id.includes(Buffer.from('holaluz').toString('hex')))
  })
})

describe('maleta', () => {
  test('lleva los movimientos, lo decidido y la fecha de guardado', () => {
    const maleta = hacerMaleta([{ id: 'x' }], { tratos: [{ id: 'netflix', trato: 'baja' }] })
    assert.equal(maleta.movimientos.length, 1)
    assert.equal(maleta.decisiones.tratos.length, 1)
    assert.match(maleta.guardado, /^\d{4}-\d{2}-\d{2}T/)
  })
})

/**
 * El circuito entero contra el worker de verdad, con un KV de mentira: si el
 * contrato entre cliente y buzón se rompe, esto lo dice antes de desplegar.
 */
describe('ida y vuelta por el buzón', () => {
  const almacen = new Map()
  const BUZONES = {
    async get(k) { return almacen.has(k) ? almacen.get(k) : null },
    async put(k, v) { almacen.set(k, v) },
  }

  /** @param {Request} peticion */
  const atender = async (peticion) => worker.fetch(peticion, { BUZONES })

  test('lo que sube con una contraseña baja con esa contraseña', async () => {
    globalThis.fetch = (url, opciones) => atender(new Request(url, opciones))

    const maleta = hacerMaleta([{ id: 'a', importe: -73315, conceptoRaw: 'AIGUES DE BARCELONA' }])
    await subir('https://buzon.test', maleta, 'la buena')
    const vuelta = await bajar('https://buzon.test', 'la buena')
    assert.equal(vuelta.movimientos[0].conceptoRaw, 'AIGUES DE BARCELONA')
  })

  test('lo guardado en el buzón es ilegible', async () => {
    const guardado = [...almacen.values()][0]
    assert.ok(!guardado.includes('AIGUES'))
    assert.ok(!guardado.includes('73315'))
  })

  test('otra contraseña ni siquiera encuentra el buzón', async () => {
    globalThis.fetch = (url, opciones) => atender(new Request(url, opciones))
    await assert.rejects(() => bajar('https://buzon.test', 'la mala'), SinBuzon)
  })

  test('el buzón rechaza lo que no es un sobre', async () => {
    const respuesta = await atender(new Request(`https://buzon.test/${'a'.repeat(32)}`, {
      method: 'PUT', body: 'hola',
    }))
    assert.equal(respuesta.status, 400)
  })

  test('el buzón rechaza identificadores inventados', async () => {
    const respuesta = await atender(new Request('https://buzon.test/../etc/passwd'))
    assert.equal(respuesta.status, 400)
  })
})

/** El otro camino: el sobre viaja como fichero y se abre en el otro dispositivo. */
describe('ida y vuelta por fichero', () => {
  const sobreComoFichero = async (maleta, contrasena) =>
    new File([JSON.stringify(await cifrar(maleta, contrasena))], 'bajamar.bajamar')

  test('lo que se envía se abre con la misma contraseña', async () => {
    const fichero = await sobreComoFichero(hacerMaleta([{ id: 'a', importe: -4891 }]), 'la buena')
    const maleta = await desdeFichero(fichero, 'la buena')
    assert.equal(maleta.movimientos[0].importe, -4891)
  })

  test('con otra contraseña no se abre', async () => {
    const fichero = await sobreComoFichero(hacerMaleta([{ id: 'a' }]), 'la buena')
    await assert.rejects(() => desdeFichero(fichero, 'la mala'), ContrasenaInvalida)
  })
})

/**
 * El riesgo de juntar dos dispositivos no es que falle: es que funcione a
 * medias y se lleve por delante una respuesta sin que nadie se entere.
 */
describe('juntar lo decidido en dos sitios', () => {
  const ANTES = '2026-09-26T10:00:00.000Z'
  const DESPUES = '2026-09-26T11:00:00.000Z'
  const trato = (id, tocado, valor = 'baja') => ({ id, trato: valor, tocado })

  test('gana quien decidió más tarde, no quien sincroniza después', () => {
    const mio = fundir({ tratos: [trato('netflix', DESPUES, 'suelto')] }, { tratos: [trato('netflix', ANTES)] })
    assert.deepEqual(mio.aEscribir, [], 'lo de aquí es más nuevo: no se toca')

    const suyo = fundir({ tratos: [trato('netflix', ANTES)] }, { tratos: [trato('netflix', DESPUES, 'suelto')] })
    assert.deepEqual(suyo.aEscribir.map(([, f]) => f.trato), ['suelto'])
  })

  test('lo decidido en cada aparato se suma, no se sustituye', () => {
    const plan = fundir({ tratos: [trato('netflix', ANTES)] }, { tratos: [trato('spotify', ANTES)] })
    assert.deepEqual(plan.aEscribir.map(([, f]) => f.id), ['spotify'])
    assert.deepEqual(plan.aBorrar, [])
  })

  test('lo borrado en el otro aparato no vuelve solo', () => {
    const plan = fundir(
      { tratos: [trato('netflix', ANTES)] },
      { lapidas: [{ id: 'tratos/netflix', tocado: DESPUES }] },
    )
    assert.deepEqual(plan.aBorrar, [['tratos', 'netflix']])
    assert.deepEqual(plan.aEnterrar.map((l) => l.id), ['tratos/netflix'])
  })

  test('pero volver a ponerlo después de borrarlo sí lo devuelve', () => {
    const plan = fundir(
      { tratos: [trato('netflix', DESPUES)] },
      { lapidas: [{ id: 'tratos/netflix', tocado: ANTES }] },
    )
    assert.deepEqual(plan.aBorrar, [], 'la lápida es más vieja que la respuesta')
  })

  test('lo que llega ya enterrado ni se escribe', () => {
    const plan = fundir({}, {
      tratos: [trato('netflix', ANTES)],
      lapidas: [{ id: 'tratos/netflix', tocado: DESPUES }],
    })
    assert.deepEqual(plan.aEscribir, [], 'escribirlo para borrarlo parecería un cambio')
    assert.deepEqual(plan.aBorrar, [])
    assert.deepEqual(plan.aEnterrar.map((l) => l.id), ['tratos/netflix'])
  })

  test('la maleta del otro no anuncia cambios que no lo son', () => {
    // El otro aparato aún lleva en su maleta lo que aquí ya se borró: mientras
    // no vuelva a subirla seguirá llegando, y no puede avisar cada vez.
    const mias = { lapidas: [{ id: 'tratos/netflix', tocado: DESPUES }] }
    const plan = fundir(mias, { tratos: [trato('netflix', ANTES)] })
    assert.equal(plan.aEscribir.length + plan.aBorrar.length, 0)
    assert.deepEqual(plan.aEnterrar, [], 'la lápida ya era mía')
  })

  test('sin novedades no se toca nada', () => {
    const plan = fundir({ tratos: [trato('netflix', ANTES)] }, { tratos: [trato('netflix', ANTES)] })
    assert.equal(plan.aEscribir.length + plan.aBorrar.length + plan.aEnterrar.length, 0)
  })

  test('viajan todas las clases de decisión, no sólo los tratos', () => {
    const plan = fundir({}, {
      objetivos: [{ id: 'o1', tocado: ANTES }],
      patrimonio: [{ id: 'p1', tocado: ANTES }],
      reglas: [{ id: 'r1', tocado: ANTES }],
      retoques: [{ id: 'm1', tocado: ANTES }],
      presupuestos: [{ id: 'casa', tocado: ANTES }],
      bultos: [{ id: 'b1', tocado: ANTES }],
      ajustes: [{ id: 'colchon', tocado: ANTES }],
    })
    assert.deepEqual(
      plan.aEscribir.map(([almacen]) => almacen).sort(),
      ['ajustes', 'bultos', 'objetivos', 'patrimonio', 'presupuestos', 'reglas', 'retoques'],
    )
  })
})
