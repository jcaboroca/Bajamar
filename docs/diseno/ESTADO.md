# Por dónde va esto

Escrito el 28 de septiembre de 2026 y puesto al día el 29. Si vas a seguir
desde aquí, léete esto antes de tocar nada: casi todo lo que se rompió esos dos
días se rompió por dar por supuesto algo que este documento cuenta.

## Lo básico

Cero dependencias, sin paso de compilación, JS vanilla. Node 22 o más.

```sh
npm test      # 291 pruebas
npm run dev   # http://localhost:4173
npm run buzon # sólo si hay que volver a desplegar el worker
```

`npm run sellar` **ya no existe**: se fue con la aplicación instalable el 29 de
septiembre. Si lees una instrucción que lo menciona, está caducada.

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

**`sw.js` ya no es un caché: es un desinstalador.** Borra todas las cachés, se
desregistra y recarga las ventanas que controle. Está ahí porque el fichero no
se puede borrar sin más: quien tuviera instalada la versión vieja seguiría
sirviéndose una copia congelada para siempre, y eso es exactamente lo que pasó.
Déjalo registrado hasta que esté claro que ya no queda ningún aparato enganchado.

El caché anterior era **cache-first**, y por eso congelaba la aplicación. Cuando
se rehaga el modo sin conexión tiene que ser **network-first**: ir siempre a la
red y caer en la copia guardada sólo si no hay. No al revés.

**El navegador de Playwright no ejecuta service workers.**
`getRegistrations()` devuelve un registro con `installing`, `waiting` y `active`
a nulo, `controller` se queda en `null` y `ready` no resuelve nunca. Es decir:
desde aquí **no se puede comprobar** si el service worker hace su trabajo. Dilo
en vez de afirmar que funciona.

En desarrollo, para saltarte cualquier copia guardada, la única receta que sirve
es una dirección nueva: `http://localhost:4173/?f=<marca de tiempo>`. Ni
`ignoreCache` ni `setCacheDisabled` cambian nada. Ojo: estrenar `?f=` devuelve el
selector de mes al mes en curso.

`docs/` está excluido del repositorio por privacidad —lleva diagnósticos con
importes reales— salvo `docs/diseno/`, que es donde está esto.

## Los nombres del estado, que engañan

`construirEstado` devuelve un objeto grande y tres de sus campos tienen nombre
de una cosa y son otra. Esto costó romper la Previsión entera el 29:

- **`estado.ritmo.porMes` es un solo número**, lo que gastas al mes en total.
  No es un desglose por categoría. El desglose es **`estado.reparto`**, un array
  de `{ categoria, nombre, alMes, cuantos }` ordenado de más caro a menos, con
  `alMes` en céntimos negativos.
- **`estado.residuo` es siempre el del periodo en curso**, mires el mes que
  mires en la interfaz. No depende del selector.
- El desglose mes a mes es `estado.detalleMensual`, no `estado.detalle`. Y el
  saldo de partida es `estado.saldoInicial`, no `saldoHoy`.

## Cómo se juntan dos dispositivos

El identificador del buzón **se deriva de la contraseña** (PBKDF2, sal propia,
32 hex). Misma contraseña, mismo buzón; una letra distinta, buzón distinto y
silencio absoluto. Ajustes enseña los primeros ocho caracteres para poder
compararlos de un vistazo entre dos aparatos.

Al juntar no gana un dispositivo entero: se **funde fila a fila** y gana la
versión tocada más tarde, con lápidas para lo borrado. La regla vale también
para las decisiones que tomas a mano (reglas de categoría, apodos, tratos,
anuales, categorías apagadas…), que son tan tuyas como los movimientos.

**Para decidir si hay que subir, nunca cuentes.** Esto estuvo mal días enteros:
comparaba cuántas decisiones había a cada lado y se callaba si aquí había
menos. El aparato con menos decisiones era justo el que tenía la única que
faltaba, así que no sub��a nunca y los dos se alejaban en silencio. Lo correcto
es `hayQueSubir(mias, suyas)` en `db.js`: ¿hay aquí algo que allí no conste, o
algo tocado más tarde aquí? Con una que haya, sube.

Se valoró meter Firebase y **se descartó con argumentos**. Con cifrado en
cliente —que es innegociable aquí— Firestore queda reducido a un almacén de
bultos opacos, exactamente lo que ya hace el worker: ni consultas, ni fusión en
servidor, ni tiempo real útil. Sin cifrado serían mil y pico movimientos
bancarios en claro en servidores de Google. Y el fallo no era de dónde se
guardaba, era de cuándo se hablaba.

## Qué se hizo el 29 de septiembre

Un día entero detrás de un síntoma tonto: dos aparatos con los mismos 1.139
movimientos enseñaban cifras distintas.

| | |
|---|---|
| `9d6d9ea` | Ajustes dice también qué has decidido a mano |
| `35a6c2d` | Cada aparato enseña de qué buzón tira |
| `662519f` | Fuera la aplicación instalable, para rehacerla sabiendo lo que hago |
| `81e0046` | Vuelve a instalarse, pero todavía sin guardar nada |
| `96f1331` | Un botón para rendirse: que mande uno y el otro se calle |
| `d18d3e3` | **El que tenía menos decisiones era justo el que tenía la que faltaba** |
| `97d2093` | **Las categorías salen de en qué gastas, no de cuánto te sobra** |

Los dos últimos son los arreglos de fondo. El segundo: la lista de barras de
Previsión se construía a partir del reparto **propuesto**, y esa propuesta va
escalada a lo que te queda por gastar. Con poco margen cada categoría recibía
calderilla y caía bajo el mínimo; con el residuo a cero o en negativo,
`proponerAsignado` devuelve `{}` y no aparecía ninguna. Al pulsar «repartir»
volvían todas, porque entonces salen del plan. O sea que la aplicación dejaba
de enseñarte en qué gastas justo cuando peor ibas de dinero. Ahora la lista
sale de `estado.reparto` y el residuo sólo decide los valores.

**Lección del día, que es de método:** se publicaron cinco explicaciones
equivocadas seguidas —código viejo en el móvil, buzones distintos, datos
distintos, ancho de pantalla, motor del navegador— y las cinco las tumbó el
dueño con un dato. Ninguna estaba verificada antes de contarla. Mira la
pantalla primero, explica después.

## Qué se hizo el 28 de septiembre

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

1. **La aplicación ya no funciona sin conexión.** Se instala en la pantalla de
   inicio, pero necesita red para arrancar. Falta rehacer el modo sin conexión
   **network-first**, y sustituir entonces el desinstalador que hoy ocupa
   `sw.js`. Acuérdate de que eso no se puede verificar desde el navegador de
   pruebas: lo tiene que comprobar el dueño en su móvil.
2. **Ciento dos reglas de categoría a ciegas.** El buzón traía ese montón de
   asignaciones manuales de comercio a categoría y no hay ninguna pantalla
   donde verlas ni limpiarlas. Si algún gasto aparece bajo un nombre que no
   toca, es ahí. Merece una lista con su botón de quitar.
3. **Verificar con datos reales.** El dueño tiene que comprobar que en un
   periodo cerrado `saldo al empezar + nómina − recibos` le lleva exactamente a
   lo que cerró. Si sobra o falta, el desglose desplegable dice dónde.
4. **Previsión se ha quedado coja.** Lo único suyo es la cascada, el reparto y
   las listas de fijos y suscripciones; su tabla mes a mes es la misma
   navegación que el Resumen ya tiene. Es candidata a repartirse y desaparecer,
   pero es decisión del dueño: sobran pestañas y él lo sabe.
5. **Las barras pequeñas cuestan de agarrar** desde que todas comparten techo.
   Lo hablado: botones de más y menos, o una casilla donde escribir la cifra.
   **No** volver a un techo por barra, que es de donde se venía y era peor.
6. **Dos bultos huérfanos de 303 KB** en el almacén del buzón, bajo
   contraseñas de prueba que se perdieron. Limpiarlos la próxima vez que se
   toque el worker.
7. **Gastos sin clasificar de bulto:** «Compras» se come 450 € al mes en 243
   apuntes y «Sin clasificar» otros 95 € en 114. Y «Personas» (los Bizums, 149 €
   al mes) mezcla dinero que luego te devuelven; `src/analisis/reembolsos.js`
   está por escribir.
8. `worker/.wrangler/cache/wrangler-account.json` sigue en el historial público
   con el id de cuenta de Cloudflare y el correo. Sacarlo de verdad exige
   reescribir el historial, que es decisión del dueño.

## Cómo comprobar que no has roto nada

`npm test` y, sobre todo, **abre la aplicación y míralo**. El 28, tres fallos de
los gordos pasaban todas las pruebas y sólo se vieron en pantalla: el botón que
no guardaba nada, la nómina contada dos veces y el bloque que no cuadraba con
el saldo. El 29 se repitió: ninguna de las 291 pruebas se enteró de que la
Previsión se quedaba sin categorías, ni de que dos aparatos llevaban días sin
hablarse. Sembrar movimientos en el IndexedDB de `localhost` y leer la pantalla
encuentra lo que la suite no.

Y cuando toques algo del estado, **comprueba en el navegador qué contiene de
verdad** antes de filtrar por ello. Lo de arriba sobre `ritmo.porMes` no es una
curiosidad: dar por supuesto que era un desglose dejó la pantalla en blanco.
