# Por dónde va esto

Escrito el 28 de septiembre de 2026 y puesto al día el 30. Si vas a seguir
desde aquí, léete esto antes de tocar nada: casi todo lo que se rompió estos
días se rompió por dar por supuesto algo que este documento cuenta.

## Lo básico

Cero dependencias, sin paso de compilación, JS vanilla. Node 22 o más.

```sh
npm test      # 306 pruebas
npm run dev   # http://localhost:4173
npm run buzon # sólo si hay que volver a desplegar el worker
```

No hay `npm run sellar`: **el sello se pone solo** en el `pretest`, o sea que
cada `npm test` reescribe `version.json` con los doce primeros caracteres de un
hash del código. `src/ui/actualizacion.js` lo compara con el publicado cada
pocos minutos y te avisa si lo que miras ya no es lo último. Consecuencia
práctica: **`version.json` sale modificado en `git status` casi siempre**, y
es correcto que entre en el commit.

El dinero son **céntimos enteros** en todas partes. Ningún importe pasa por un
`float` más allá del instante en que se lee del `.xls`.

**La aplicación publicada está en https://jcaboroca.github.io/Bajamar/** y es la
única que cuenta: verificar en `localhost` y dar algo por bueno ha salido mal
todas las veces que se ha intentado.

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

## Cuenta y tarjeta viven en la misma tabla

En `movimientos` conviven los apuntes de la cuenta corriente y los del extracto
de la tarjeta de crédito. **Los de tarjeta llevan el id con prefijo `tarjeta:`**;
los de cuenta, no. Parecen lo mismo y no lo son: un apunte de tarjeta no ha
salido de la cuenta, saldrá dentro del recibo mensual que la liquida.

Esto hizo perder una tarde el 29. Tres cargos del ayuntamiento del 1 de julio
—10,24 + 36,83 + 38,38— se leyeron como cargos de la cuenta y se concluyó que
faltaban 370,90 € por salir en octubre y diciembre. Eran apuntes de la tarjeta:
el banco había abonado en cuenta tres recibos enteros (556,35 €) para
fraccionárselos en la tarjeta, y las otras dos cuotas ya habían ido dentro del
recibo de tarjeta, que saltó de 34,63 € en junio a 379,83 € en julio y 664,27 €
en agosto. **Antes de decir que falta dinero, mira de qué origen es el apunte.**

De paso: «FRACCIONAMIENTO» no es cosa del cobrador sino del banco, que hace lo
mismo con una compra de 70 € en una tienda de perros y con una transferencia de
468 € a MyInvestor. No lo leas como un calendario del acreedor.

## Un recibo troceado sigue siendo un recibo

El ayuntamiento cobra el mismo día el IBI de una casa, el de la otra y la basura,
y los tres llegan con el mismo texto: `IMPUESTOS AJ. GAVA`. Sumarlos por día daba
un número que no se parecía a ningún recibo suyo y que nadie podía reconocer
—era la queja «los impuestos no me cuadran»—. Lo que sí los distingue es el
**precio**: cada uno vale lo mismo año tras año, salvo algún céntimo de redondeo
al trocearlo en plazos.

`mismoPrecioDistintoRecibo` en `compromisos.js` agrupa por importe con una
tolerancia de **cinco céntimos**, ni uno más: 80,25 y 80,23 son el mismo recibo,
110,50 y 110,24 no. Los 19 recibos del ayuntamiento se reconocen ahora uno a uno.

Dos cosas que cuestan de ver y tienen prueba:

- Al separar por precio, cada grupo pierde la prueba de que ese cobrador tiene
  calendario fijo, y el plazo del que sólo hay un caso desaparecía. Por eso
  `admitibles` decide mirando **al cobrador entero**, no a cada cadena.
- Lo que no se repite vuelve a un montón común que se sigue agrupando por día:
  sin eso, un cargo suelto dejaría de preverse por haberlo separado.

**Los cuatro plazos son un recibo, no cuatro**, así que quien bautiza uno bautiza
los cuatro, y quien marca uno como devuelto marca los cuatro. La herencia entre
hermanos está en `apodar`, dentro de `estado.js`, y reconoce hermanos por
cobrador y precio ±5 céntimos: exactamente el mismo criterio que los separó.

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

**Para verificar un despliegue hay que pedir que no se cachee.** GitHub Pages
sirve con `cache-control: max-age=600`, y mientras una pestaña siga viva el
navegador ni siquiera vuelve a pedir los módulos. El 29 se dio por verificado un
arreglo mirando una página que estaba ejecutando el código anterior, y el fallo
seguía en pantalla. La única receta que sirve:

```js
await page.setExtraHTTPHeaders({ 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' })
```

antes de navegar. Y comprueba el sello de lo que estás mirando: `SELLO` en
`src/ui/version.js` tiene que coincidir con el `version.json` que acabas de
publicar. Pages tarda entre cuarenta segundos y dos minutos.

En desarrollo, para saltarte cualquier copia guardada, la única receta que sirve
es una dirección nueva: `http://localhost:4173/?f=<marca de tiempo>`. Ni
`ignoreCache` ni `setCacheDisabled` cambian nada. Ojo: estrenar `?f=` devuelve el
selector de mes al mes en curso.

`docs/` está excluido del repositorio por privacidad —lleva diagnósticos con
importes reales— salvo `docs/diseno/`, que es donde está esto.

## Qué contesta cada pestaña

Son seis y cada una tiene una pregunta. Si te encuentras añadiendo algo que no
contesta la de su pestaña, va en otra.

| | |
|---|---|
| **Resumen** | ¿Llego? ¿Cuánto tengo para vivir? ¿Voy bien? ¿Y más allá? |
| **Movimientos** | ¿En qué se fue esto? |
| **Previsión** | La cascada de un mes: de la nómina a lo que queda |
| **Categorías** | Qué se repite, cada cuánto y cuánto vale |
| **Patrimonio** | Lo que no está en la cuenta |
| **Ajustes** | Colchón, ventana del ritmo, sincronización |

El horizonte a 3/6/12 meses está en el Resumen y no en Previsión: es la misma
pregunta que la bajamar, sólo que más lejos. Previsión hablaba a la vez de este
mes y del año entero, y las listas de recibos —que se tocan dos veces al año—
competían por la pantalla con la cascada, que se mira cada semana.

Los tres escalones con detalle de la cascada se pliegan. **Su estado abierto se
recuerda en un `Set` del módulo**, porque la cascada se reconstruye entera en
cada refresco y cualquier decisión dispara uno: sin eso, abrir «Día a día»,
mover una barra y verlo cerrarse sería el comportamiento normal.

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
- **`estado.proyeccion` no es un array**: no le pidas un `.filter`.
- Las entradas de `detalleMensual` se identifican por **`id`** (`'2026-10'`), no
  por `mes`.
- Las filas crudas de `movimientos` **no tienen `entidadId`**, y el texto del
  banco está en `conceptoRaw`, no en `concepto`.

Cuando dudes, reconstruye el estado en el navegador y mira qué contiene de
verdad antes de filtrar por ello:

```js
const db = await import('/Bajamar/src/almacen/db.js')
const est = await import('/Bajamar/src/estado.js')
const pref = await import('/Bajamar/src/almacen/preferencias.js')
const p = await pref.cargar()
const e = est.construirEstado(await db.leerTodo('movimientos'), {
  categoriasManuales: p.reglas, retoques: p.retoques, planes: p.planes,
  patrimonio: p.patrimonio, tratos: p.tratos, apodos: p.apodos, unicos: p.unicos,
  anuales: p.anuales, ritmos: p.ritmos, manuales: p.manuales, apagadas: p.apagadas,
  inversiones: p.inversiones, saltados: p.saltados, ventanaRitmo: p.ventanaRitmo,
  colchon: p.colchon, devueltos: p.devueltos,
})
```

## Lo que sale de tu cuenta y no es tu gasto

El IBI de su madre sale de su cuenta el día que toca y vuelve en un bizum unos
días después. En el panel de cada recibo hay un campo, «¿Te lo devuelve
alguien?», que se guarda en el almacén `devueltos` (**base de datos v13**).

El reparto es deliberado y no conviene deshacerlo sin entender por qué:

- **Categorías descuenta** el recibo del coste mensual y su línea dice quién te
  lo devuelve. Esa pestaña contesta «cuánto me cuesta vivir un mes», y ese
  dinero no te cuesta.
- **La previsión no se entera de nada.** El dinero sale el día que sale. Y el
  bizum de vuelta **no se prevé**: contar con dinero que depende de que alguien
  se acuerde es justo el optimismo que esta aplicación existe para no tener.

Así queda intacta la invariante 2. El dueño pidió que Categorías lo descontara
sabiendo que se le propuso lo contrario —prever el bizum entrante— y esto es el
acuerdo: la cuenta de la vida descuenta, el saldo no.

Números reales para reconocer que funciona: impuestos de 189,80 €/mes a
**164,27 €/mes** marcando dos recibos, el IBI de 48,91 € y el vado de 110,50 €.

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

## Qué se hizo el 29 de septiembre por la tarde y el 30

| | |
|---|---|
| `99269b4` | En el Resumen, lo pagado y lo que falta se distinguen por el color |
| `fdf5f4d` | La app avisa cuando lo que miras ya no es la última versión |
| `3f4deb7` | La comisión del banco no es un gasto: te la devuelven el mismo día |
| `ee5b1b3` | **«Ya no lo pagas» era mentira: la comisión la pagas y te la devuelven** |
| `5fff5c7` | **Los impuestos del ayuntamiento ya se reconocen uno a uno** |
| `3384302` | Bautizar un plazo bautiza los cuatro |
| `358550c` | Ya puedes decir quién te devuelve un recibo |

El de los impuestos es el importante y nació de una queja de tres palabras: «los
impuestos no me cuadran». Un comentario del código y una prueba con nombre
defendían activamente la creencia falsa —«el IBI, la basura y el vado son un
recibo»— y los dos cayeron cuando el dueño mandó la tabla del ayuntamiento. Que
una prueba pase no significa que afirme algo cierto.

El de la comisión es una regresión propia: al enrutar el par que se anula por
`deBaja` heredó el cartel de las bajas y la aplicación decía «ya no lo pagas» de
algo que sí se paga. Ahora tiene motivo propio, `anulado`, con su texto —«te lo
devuelven el mismo día»— y no se puede reabrir, porque no fue una decisión suya.

**Método, otra vez.** El ritual de comprobar que una prueba nueva falla sin el
arreglo (`cp fichero /tmp/ok.js && git checkout HEAD -- fichero && npm test`) se
aplicó tres veces y las tres mereció la pena. Una prueba que no falla cuando
debería no vale nada.

Y el día acabó con un diagnóstico equivocado más, el de los 370,90 € que no
faltaban, tumbado por el dueño con un «no puede ser que me cobren sólo un tercio
de un cuarto, míralo bien». Tenía razón: está contado arriba, en lo de cuenta y
tarjeta.

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
| `feef1d2` | Dejar por escrito dónde se queda esto |
| *(este)* | Previsión se queda con la cascada; lo demás, a Categorías |

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

Repasado entero el 30 de septiembre: 9.581 líneas de fuente en 46 ficheros,
3.254 de pruebas, 306 en verde, cero dependencias. No hay ningún fichero que
nadie importe. Por orden de lo que más molesta:

1. **La aplicación ya no funciona sin conexión.** Se instala en la pantalla de
   inicio, pero necesita red para arrancar. `sw.js` son dieciocho líneas cuyo
   único trabajo es desinstalar la versión vieja. Falta rehacer el modo sin
   conexión **network-first** y sustituir entonces ese desinstalador. Acuérdate
   de que eso no se puede verificar desde el navegador de pruebas: lo tiene que
   comprobar el dueño en su móvil. **Es lo único de esta lista que cambia lo que
   la aplicación es, y no sólo lo que enseña.**
2. **Categorías no enseña categorías, enseña recibos.** Las 102 reglas de
   comercio a categoría que trajo el buzón no tienen ninguna pantalla donde
   verse ni corregirse, y `estado.reparto` —cuánto se va en comida, en coche, en
   casa— se calcula y no se pinta en ningún sitio. Ya tiene sitio: esa pestaña.
3. **Unos 545 € al mes sin nombre.** «Compras» se lleva 450 € en 243 apuntes y
   «Sin clasificar» otros 95 € en 114. Es casi un quinto del gasto. Mientras eso
   sea un borrón, el suelo previsto es bueno pero no exacto.
4. **«Personas» sigue mezclando lo que te devuelven.** Los recibos ya se
   resuelven con `devueltos`; los bizums sueltos, no. `src/analisis/reembolsos.js`
   sigue sin escribirse, y quizá lo que toque no sea escribirlo sino estirar
   `devueltos`.
5. **No hay forma de borrar un recibo apuntado a mano.** `quitarManual` está
   escrita en `preferencias.js` y no la llama nadie: la función existe, el botón
   no.
6. **Verificar con datos reales.** El dueño tiene que comprobar que en un
   periodo cerrado `saldo al empezar + nómina − recibos` le lleva exactamente a
   lo que cerró. Si sobra o falta, el desglose desplegable dice dónde.
7. **Previsión se ha quedado flaca.** Se le quitó el horizonte —al Resumen— y
   las listas de recibos —a Categorías. Le queda la cascada del mes y el
   simulador. Seis pestañas son muchas en un móvil y ésta es la candidata a
   caber dentro del Resumen. De momento se queda, porque es donde se decide.
8. **Las barras pequeñas cuestan de agarrar** desde que todas comparten techo.
   Lo hablado: botones de más y menos, o una casilla donde escribir la cifra.
   **No** volver a un techo por barra, que es de donde se venía y era peor.
9. **Informes** mensual, trimestral y anual, y **salud financiera**: están en la
   especificación y no se han empezado.
10. **Código muerto de verdad**, poco pero hay: `totalesPorCategoria` en
    `estado.js` y `esGasto` en `tipos.js`, que no llama nadie ni las pruebas. Y
    ocho `export` que sobran porque sólo se usan dentro de su fichero:
    `preguntarTrato`, `importarCuenta`, `importarTarjeta`, `esOle2`, `ALMACENES`,
    `DECISIONES`, `SUELEN_VOLVER`, `OFICIOS`.
11. **Dos bultos huérfanos de 303 KB** en el almacén del buzón, bajo
    contraseñas de prueba que se perdieron. Limpiarlos la próxima vez que se
    toque el worker.
12. `worker/.wrangler/cache/wrangler-account.json` sigue en el historial público
    con el id de cuenta de Cloudflare y el correo. Sacarlo de verdad exige
    reescribir el historial, que es decisión del dueño.

Roces menores, ya contados al dueño y sin arreglar: en Previsión la cifra grande
es la del mes entero mientras la frase de debajo divide el resto entre los días
que quedan; el día 1 de un mes la línea dice `Día a día, hasta hoy −0,00 €`;
`formatEurosRedondo` usa un guion normal donde `formatEuros` usa el menos
tipográfico; y «SUMUP TALLER DE LA P» está clasificado como vehículos cuando es
una pizzería.

## Lo que está bien y conviene no tocar

El modelo del periodo entre nóminas y las cinco invariantes. Son lo que ha hecho
que cada vez que algo no cuadraba se supiera *dónde* mirar. Y la disciplina de
que un euro que sale de la cuenta cuenta siempre, pase lo que pase con quién te
lo devuelva después: el 29 estuvo a punto de romperse y aguantó.

## Cómo comprobar que no has roto nada

`npm test` y, sobre todo, **abre la aplicación publicada y míralo**. El 28, tres
fallos de los gordos pasaban todas las pruebas y sólo se vieron en pantalla: el
botón que no guardaba nada, la nómina contada dos veces y el bloque que no
cuadraba con el saldo. El 29 se repitió: ninguna de las 291 pruebas se enteró de
que la Previsión se quedaba sin categorías, ni de que dos aparatos llevaban días
sin hablarse. Sembrar movimientos en el IndexedDB de `localhost` y leer la
pantalla encuentra lo que la suite no —pero lo último que se mira antes de decir
«está arreglado» tiene que ser la web publicada, sin caché.

Cuando escribas una prueba nueva, **comprueba que falla sin el arreglo**:

```sh
cp src/fichero.js /tmp/ok.js && git checkout HEAD -- src/fichero.js
npm test          # tiene que salir en rojo
cp /tmp/ok.js src/fichero.js
```

Y cuando toques algo del estado, **comprueba en el navegador qué contiene de
verdad** antes de filtrar por ello. Lo de arriba sobre `ritmo.porMes` no es una
curiosidad: dar por supuesto que era un desglose dejó la pantalla en blanco.

En la cascada hay una comprobación que vale por diez: **el último «quedan» tiene
que ser igual que «Acabas con»**. Al hacer plegables los escalones se coló un
`queda += c.diaADia` de más y la resta se hacía dos veces; las 291 pruebas
pasaron y la pantalla lo cantaba a la primera.
