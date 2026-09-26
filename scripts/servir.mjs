// @ts-check
/**
 * Servidor estático mínimo para desarrollo. No sirve para producción y no
 * pretende hacerlo: sólo evita tener que instalar nada para abrir la
 * aplicación con módulos ES, que no funcionan desde file://
 *
 *   npm run dev
 */

import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'

const RAIZ = resolve(import.meta.dirname, '..')
const PUERTO = Number(process.env.PUERTO ?? 4173)

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
}

createServer(async (peticion, respuesta) => {
  const url = new URL(peticion.url ?? '/', `http://localhost:${PUERTO}`)
  const pedido = url.pathname === '/' ? '/index.html' : url.pathname

  // Sin esto, una petición a /../../.ssh/id_rsa saldría del directorio servido.
  const destino = join(RAIZ, normalize(decodeURIComponent(pedido)))
  if (!destino.startsWith(RAIZ + '/') && destino !== join(RAIZ, 'index.html')) {
    respuesta.writeHead(403).end('Fuera del directorio servido')
    return
  }

  try {
    const info = await stat(destino)
    if (!info.isFile()) throw new Error('no es un fichero')
    respuesta.writeHead(200, {
      'content-type': TIPOS[extname(destino)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    })
    createReadStream(destino).pipe(respuesta)
  } catch {
    respuesta.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('No está')
  }
}).listen(PUERTO, () => {
  console.log(`Bajamar en http://localhost:${PUERTO}`)
})
