/**
 * Buzón de Bajamar: guarda un sobre cifrado y lo devuelve.
 *
 * Deliberadamente tonto. No sabe qué guarda, no puede saberlo, y no quiere
 * saberlo: recibe bytes cifrados en el navegador y los escribe en KV bajo un
 * identificador que el cliente deriva de su contraseña.
 *
 * Eso significa que no hay cuentas, ni tokens, ni sesiones. La seguridad no la
 * pone este worker: la pone el hecho de que el contenido ya viene cerrado y de
 * que el identificador es impredecible. Si alguien acierta un identificador,
 * se lleva un sobre que no puede abrir.
 */

const LIMITE = 5 * 1024 * 1024
const ID_VALIDO = /^[a-f0-9]{32}$/

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, PUT, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
}

/** @param {unknown} cuerpo @param {number} estado */
function json(cuerpo, estado = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS },
  })
}

export default {
  /**
   * @param {Request} peticion
   * @param {{ BUZONES: KVNamespace }} entorno
   */
  async fetch(peticion, entorno) {
    if (peticion.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

    const id = new URL(peticion.url).pathname.slice(1)
    if (!ID_VALIDO.test(id)) return json({ error: 'identificador no válido' }, 400)

    if (peticion.method === 'GET') {
      const sobre = await entorno.BUZONES.get(id)
      if (sobre === null) return json({ error: 'vacío' }, 404)
      return new Response(sobre, {
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS },
      })
    }

    if (peticion.method === 'PUT') {
      const texto = await peticion.text()
      if (texto.length > LIMITE) return json({ error: 'demasiado grande' }, 413)

      // Sin esto el buzón sería un alojamiento de ficheros arbitrarios gratis.
      let sobre
      try {
        sobre = JSON.parse(texto)
      } catch {
        return json({ error: 'esto no es un sobre' }, 400)
      }
      if (sobre?.v !== 1 || typeof sobre.datos !== 'string' || typeof sobre.iv !== 'string') {
        return json({ error: 'esto no es un sobre' }, 400)
      }

      await entorno.BUZONES.put(id, texto, {
        expirationTtl: 60 * 60 * 24 * 365,
      })
      return json({ guardado: true })
    }

    return json({ error: 'método no admitido' }, 405)
  },
}
