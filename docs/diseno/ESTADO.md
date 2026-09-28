# Por dónde va esto

Escrito el 28 de septiembre de 2026, al acabar una sesión larga. Si vas a
seguir desde aquí, léete esto antes de tocar nada: casi todo lo que se rompió
hoy se rompió por dar por supuesto algo que este documento cuenta.

## Lo básico

Cero dependencias, sin paso de compilación, JS vanilla. Node 22 o más.

```sh
npm test      # 278 pruebas
npm run dev   # http://localhost:4173
```

El dinero son **céntimos enteros** en todas partes. Ningún importe pasa por un
`float` más allá del instante en que se lee del `.xls`.

## El modelo, que es lo que no se adivina

**Un mes no es un mes natural: es el periodo entre dos nóminas.** Septiembre va
del 25 de agosto al 24 de septiembre, porque el 25 de agosto entró el dinero
con el que se vive septiembre. El día en que entra la nómina pertenece al
periodo que abre, no al que cierra.

Vive en `src/analisis/periodos.js`. Los cortes son las fechas reales de las
nóminas para lo ya vivido y las previstas para lo que viene; quién corta lo
decide `estado.js` (las entidades categorizadas como `nomina`, y si no hay
ninguna, el mayor ingreso que se repita).

Casos resueltos y con prueba, no los redescubras:

- Cobrar el 23 en vez del 25 acorta ese periodo; los siguientes no se mueven.
- Una paga extra **no** parte el mes en dos: cuando caen dos en el mismo mes,
  corta la primera.
- Un mes sin nómina **alarga** el periodo, no lo trocea.
- Sin nómina reconocida se cae a meses naturales y se dice en la interfaz.
- El primer periodo del extracto está cortado por definición: sale marcado
  `completo: false` y no cuenta para medir la costumbre.

Hasta hoy esto se apañaba con un desplazamiento contable —el mes era del 1 al
30 y los cobros de final de mes se apuntaban al siguiente a mano— y costaba
tres conceptos, una segunda línea en la gráfica y diez días al mes con dos
meses vivos a la vez. **No lo reintroduzcas.** Si te encuentras escribiendo
algo parecido a `mesContable`, es que has vuelto al modelo viejo.

## Las cinco invariantes

Si rompes una de éstas, la aplicación vuelve a contradecirse a sí misma. Todas
tienen prueba.

1. **La cuenta cierra.** `apertura + ingresos.total + gastos.total === saldoFinal`.
   Falló todo el día porque el bloque filtraba por categoría y la curva no.
2. **Un euro que sale de la cuenta cuenta**, sea cual sea su categoría. Los
   traspasos a inversión salen de la cuenta: restan. Que no sean «gasto» no los
   devuelve.
3. **Lo previsto es el total menos lo real**, nunca una cuenta aparte. Así las
   dos mitades no pueden contradecir al total.
4. **Los periodos encajan** sin solaparse y sin dejar un día fuera.
5. **El plan manda dentro de su periodo y ni un día más.** Su ritmo es «lo que
   queda entre los días que quedan»; estirarlo a otro periodo da cifras
   absurdas. Por eso `proyectar` acepta el goteo como función.

## La fórmula del bloque central

```
Saldo al empezar  +  nómina y otros ingresos  −  todo lo que sale con fecha
= lo que queda para el día a día
```

Sin filtros. Lo único que se separa es en dos montones: lo que sale con fecha
(recibos, cuotas, seguros, traspasos) y lo que se decide cada mañana. De
distinguirlos se encarga `gastoOrdinario`; no te hagas una segunda idea de qué
es un recibo.

Dos excepciones que ya están puestas:

- Las **compras de la tarjeta** (`origen === 'tarjeta'`) no cuentan: lo que
  cuenta es el cargo con el que el banco las liquida.
- El **abono de un fraccionamiento** no es un ingreso. El banco te devuelve lo
  que acaba de cobrarte para cobrártelo en tres cuotas, así que va con lo que
  tiene fecha y se compensa con la liquidación que deshace. Se reconoce por
  `m.fraccionado`, que el importador marca por el concepto.

## Trampas del entorno

**El service worker es cache-first con la versión a mano** (`const CAU` en
`sw.js`). En desarrollo te sirve módulos viejos mezclados con nuevos y **sin un
solo error en consola**: parece que tu edición no hace nada. Para ver cambios:
desregistrar el SW, borrar `caches`, **y navegar a otra página antes de
volver** — si no, la pestaña sigue controlada por el anterior aunque
`getRegistrations()` devuelva cero.

Y `PROGRAMA` es una lista manual: **todo módulo nuevo hay que añadirlo** o la
app falla sin conexión. Hoy faltaban seis. Sube `CAU` en cada despliegue o el
arreglo se publica y nadie lo ve.

`docs/` está excluido del repositorio por privacidad —lleva diagnósticos con
importes reales— salvo `docs/diseno/`, que es donde está esto.

## Qué se hizo hoy

De abajo arriba, con el porqué en cada mensaje de commit:

| | |
|---|---|
| `9ea0264` | Dos veces 2.800 € en octubre que no eran el mismo dinero |
| `aeab7c9` | La bajamar es la del mes entero, no la de los días que quedan |
| `d478d26` | La bonificación del banco no paga el mes que viene |
| `d4be02f` | El botón de «este mes no» no hacía nada: cortaba la propagación |
| `001ecf1` | **El mes va de nómina a nómina** — el cambio grande |
| `85c11c6` | Decir cuánto tienes, que estaba y no se veía |
| `d4f255d` | La tabla dice con cuánto entras y con cuánto acabas |
| `6ea7b7b` | «Empiezas con» contaba la nómina dos veces |
| `b6ed41b` | Un euro que sale cuenta, sea lo que sea |
| `c0e6772` | Lo que fraccionas no es un ingreso |
| `0a3453f` | Abrir la nómina y los recibos para ver el desglose |

El Resumen pasó de diez bloques a tres: **¿llego?**, **¿cuánto tengo para vivir
y a qué ritmo?** y **¿voy bien?**. Todo lo demás salió de ahí.

## Qué queda

Por orden de lo que más molesta:

1. **Verificar con datos reales.** El dueño tiene que comprobar que en un
   periodo cerrado `saldo al empezar + nómina − recibos` le lleva exactamente a
   lo que cerró. Si sobra o falta, el desglose desplegable dice dónde.
2. **Previsión se ha quedado coja.** Lo único suyo es la cascada, el reparto y
   las listas de fijos y suscripciones; su tabla mes a mes es la misma
   navegación que el Resumen ya tiene. Es candidata a repartirse y desaparecer,
   pero es decisión del dueño: sobran pestañas y él lo sabe.
3. **`worker/.wrangler/cache/wrangler-account.json` está commiteado** en un
   repositorio público. Es caché local de wrangler y no debería estar.
4. **La versión del service worker se sube a mano.** Se puede derivar de un
   hash de los ficheros. Casi se olvida dos veces en un día.
5. **El README está desfasado**: dice 254 pruebas y la estructura no menciona
   `periodos.js`. Y su tercera decisión —«con dos apariciones no se infiere una
   periodicidad»— está contada más tajante de lo que hace el código, que tiene
   una función llamada `anualesDeDosVistas`.
6. **`estado.mesEnCurso` ya no existe**, pero quedó dicho que había que
   renombrarlo: comprueba que no quede ningún nombre que signifique dos cosas.

## Cómo comprobar que no has roto nada

`npm test` y, sobre todo, **abre la aplicación y míralo**. Hoy tres fallos de
los gordos pasaban todas las pruebas y sólo se vieron en pantalla: el botón que
no guardaba nada, la nómina contada dos veces y el bloque que no cuadraba con
el saldo. Sembrar movimientos sintéticos en el IndexedDB de `localhost` y leer
la pantalla encontró lo que la suite no.
