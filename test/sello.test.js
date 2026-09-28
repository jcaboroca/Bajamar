// @ts-check
/**
 * El service worker se sellaba a mano y se olvidó dos veces en un solo día. Un
 * olvido no rompe nada visible: la aplicación funciona con red y publica un
 * arreglo que nadie llega a ver. Por eso lo vigila una prueba y no la memoria.
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'

test('sw.js está sellado: lista completa y versión al día', () => {
  assert.doesNotThrow(() => {
    execFileSync('node', ['scripts/sellar.mjs', '--comprobar'], { stdio: 'pipe' })
  }, 'Corre `npm run sellar` y vuelve a probar.')
})
