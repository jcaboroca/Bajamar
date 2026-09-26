// @ts-check

/**
 * URL del buzón de sincronización, sin barra final.
 *
 * Vacío = sin sincronización remota: la app funciona igual, en local, y para
 * pasar los datos a otro dispositivo se usa el fichero cifrado.
 *
 * Para activarlo, despliega el worker de `worker/` y pega aquí su dirección:
 *   cd worker
 *   npx wrangler kv namespace create BUZONES   # pega el id en wrangler.toml
 *   npx wrangler deploy
 */
export const BUZON = ''
