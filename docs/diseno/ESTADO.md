# Por dónde va esto

Escrito el 28 de septiembre de 2026 y puesto al día el 1 de octubre. Si vas a
seguir desde aquí, léete esto antes de tocar nada: casi todo lo que se rompió
estos días se rompió por dar por supuesto algo que este documento cuenta.

**La regla que más ha costado aprender:** los extractos reales del dueño están
en `~/Downloads/` (`DDMMYYYY_0468_….xls` la cuenta, `DDMMYYYY 4106________3018.xls`
la tarjeta). Antes de suponer cómo funciona su banco, **pásalos por
`importarXls` en node y mira**. Tres arreglos de la tarjeta hechos a ciegas
fallaron; con los ficheros abiertos salió al céntimo a la primera.

## Lo básico

Cero dependencias, sin paso de compilación, JS vanilla. Node 22 o más.

```sh
npm test      # 324 pruebas
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

## La tarjeta es una foto, no un historial

Esto salió de comparar el extracto de tarjeta del 26 de septiembre con el del
30, y cuadra al céntimo con lo que cobró el banco:

- **El extracto de tarjeta es una foto de lo que falta por cobrar** el día que
  se descarga. Lo ya liquidado desaparece de la siguiente. **Sólo vale la
  última foto**: `soloLaUltimaFoto` en `estado.js` tira las demás antes de
  calcular nada. Juntarlas cobraba dos veces lo ya pagado.
- Cada fila lleva `foto` (día sacado del nombre del fichero + hora de
  importar) y un id `tarjeta:<día>-<huella del contenido>:<i>`. Antes el id era
  sólo la posición, y la foto del 30 pisó cuatro filas de la del 26 y dejó
  ocho mezcladas. Las filas viejas, sin `foto`, sólo cuentan si no hay otra.
- **Lo fraccionado se cobra a fin de mes empezando por el mes siguiente** a la
  compra, en tres cuotas. Lo del 22 de septiembre no entró el 30.
- **Cada fila fraccionada de la foto es una cuota que se repite tres meses**,
  haya o no abono en la cuenta: el dueño fracciona muchas compras dentro de la
  propia tarjeta y no dejan rastro en la cuenta. Un abono de la cuenta que una
  foto posterior ya no trae está pagado entero. Está en
  `cuotasPendientes` (`fraccionados.js`).
- Lo **no** fraccionado entra entero en la próxima liquidación
  (`pendienteTarjeta`). Todavía no se ha visto en sus datos una compra normal:
  la primera que haya, comprobar con el extracto en qué recibo cae.

Comprobación con sus ficheros: con la foto del 26, el cobro del 30 de
septiembre da **565,30 €**; con la del 30, el del 31 de octubre da **346,77 €**
y luego 161,32 en noviembre y diciembre. `estado.proximoCobroTarjeta`
(`{ fecha, importe, luego, hasta }`) es lo que pinta Movimientos › Tarjeta.

La liquidación se busca por **categoría `tarjeta`**, no por el texto del banco:
en cuanto la entidad se reconoce el compromiso se llama «Liquidación de la
VISA» y la expresión `TARJETA CREDITO` ya no casaba nunca.

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

**`sw.js` guarda la aplicación entera en el aparato** para que arranque sin
red. Un almacén por sello (`bajamar-<sello>`), `skipWaiting` + `clients.claim`,
y al activarse borra los demás. `version.json` va siempre a la red. Dos cosas
que no se ven y lo sostienen:

- **El sello se escribe dentro de `sw.js`** (`scripts/sellar.mjs`, en el
  `pretest`): el script de un service worker es lo único que el navegador no
  sirve de su caché, así que es el único canal fiable para anunciar versión.
  Para que el hash no se muerda la cola, `sw.js` se pesa con el sello quitado.
- **`version.json` lleva la lista de ficheros** que se guardan y que el botón
  «hay versión nueva» pide a la fuerza antes de recargar. Sin eso, el botón
  entraba en bucle diez minutos: recargar servía los módulos viejos de la
  caché de Pages. **Esa lista tiene que incluir `config.js`**, que vive fuera de
  `src/`: faltó y sin red no arrancaba nada, porque basta un import roto para
  que no se ejecute la aplicación. `test/sellar.test.js` recorre ahora todos
  los imports desde `app.js` y falla si alguno no está en la lista.

**Playwright no ejecuta service workers.**
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

**La página de Playwright puede tener la contraseña del buzón puesta** —el 30
apareció una de quince caracteres que nadie había tecleado ahí—. Antes de meter
datos en ella: `(await import('/Bajamar/src/almacen/llavero.js')).olvidarClave()`.
Y al acabar, `db.vaciar()`.

## Qué contesta cada pestaña

Son cinco y cada una tiene una pregunta. Si te encuentras añadiendo algo que no
contesta la de su pestaña, va en otra.

| | |
|---|---|
| **Resumen** | ¿Llego? ¿De dónde sale y cuánto tengo para vivir? ¿Voy bien? ¿Y más allá? |
| **Movimientos** | ¿En qué se fue esto? Y, con el filtro Tarjeta, cuánto me van a cobrar |
| **Categorías** | En qué se me va el día a día, y qué se repite |
| **Patrimonio** | Lo que no está en la cuenta |
| **Ajustes** | Colchón, ventana del ritmo, sincronización |

**Previsión ya no existe como pestaña**: el dueño vio que repetía el Resumen.
La cascada vive en Resumen (`#de-donde-sale`), abierta, **sólo en el mes en
curso**; en los demás meses sale «Cómo fue agosto» (`#bloque-vivir`). Nunca
los dos: decían lo mismo dos veces seguidas. El simulador sigue dentro del
escalón «Día a día» de la cascada, y «Cómo vas» tiene un botón que lo abre
(`abrirReparto`). Un `#prevision` guardado cae en Resumen.

**«Ya está pagado»** (almacén `pagados`, base de datos **v14**, clave `reciboId|mes` como
`saltados`): el evento se mueve a hoy con `marcado: true`, sale como pagado y
`estado.saldoHoy` lo descuenta. Cuando el extracto trae el cargo, el recibo avanza
de mes, la marca ya no casa con nada y manda el importe real. Sin limpiar nada.

En la cascada, **lo pagado va en el color del texto y lo pendiente en ámbar**,
como en toda la aplicación. Ámbar significa «todavía no ha pasado».

Categorías empieza por «En qué se te va el día a día»: `estado.reparto`, cada
categoría plegada con sus comercios; tocar uno le cambia la categoría
(`ponerRegla`, vale para todo lo suyo).

Los tres escalones con detalle de la cascada se pliegan. **Su estado abierto se
recuerda en un `Set` del módulo**, porque la cascada se reconstruye entera en
cada refresco y cualquier decisión dispara uno: sin eso, abrir «Día a día»,
mover una barra y verlo cerrarse sería el comportamiento normal.

## Los nombres del estado, que engañan

`construirEstado` devuelve un objeto grande y tres de sus campos tienen nombre
de una cosa y son otra. Esto costó romper la Previsión entera el 29:

- **`estado.ritmo.porMes` es un solo número**, lo que gastas al mes en total.
  No es un desglose por categoría. El desglose es **`estado.reparto`**, un array
  de `{ categoria, nombre, alMes, cuantos, comercios }` ordenado de más caro a
  menos, con `alMes` en céntimos negativos. `comercios` usa la misma escala, así
  que suman su trozo.
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

**Subir siempre después de bajar y mezclar.** Había tres sitios que suben al
buzón y sólo uno mezclaba antes; los otros dos —después de importar y el
botón «Enviar cifrado»— subían lo que hubiera en ese aparato y podían dejar el
buzón a medias. Ahora los tres pasan por `mezclarYSubir` en `app.js`, y si la
contraseña no abre lo que ya hay, no se sube nada.

Se valoró meter Firebase y **se descartó con argumentos**. Con cifrado en
cliente —que es innegociable aquí— Firestore queda reducido a un almacén de
bultos opacos, exactamente lo que ya hace el worker: ni consultas, ni fusión en
servidor, ni tiempo real útil. Sin cifrado serían mil y pico movimientos
bancarios en claro en servidores de Google. Y el fallo no era de dónde se
guardaba, era de cuándo se hablaba.

## Qué se hizo el 30 de septiembre por la noche y el 1 de octubre

| | |
|---|---|
| `c48ee2e` | La liquidación de la VISA ya no te la cobro dos veces |
| `13af5fa` | El botón de la versión nueva ya no se muerde la cola |
| `8fc8b3b` | **Bajamar ya existe sin cobertura** |
| `de7d123` | Categorías ya enseña en qué se te va el día a día |
| `cec0676` | **Previsión se muda a Resumen, y quedan cinco pestañas** |
| `b604158` | Un mes se cuenta una vez, no dos |
| `1f766d7` | En la cascada, lo pagado y lo que falta vuelven a distinguirse |
| `573ac38` | El euro ya no se queda solo en el renglón de abajo |
| `65677cc` | Sin conexión ya arranca (faltaba `config.js`) |
| `7201703` | **La tarjeta, por fin, con tus números: 565,30 el 30 y 346,77 el 31** |
| `70d659d` | **El buzón ya no se pisa con lo que haya en un aparato a medias** |
| `363def7` | Disney+ y HBO Max se llaman por su nombre, aunque los cobre PayPal |
| `b4c3980` | Una pizzería, un cero sin signo y el código que sobraba |
| `d99ec5b` | **El IBI de octubre ya no desaparece el día que toca** |
| `7ce29ac` | **«Ya está pagado»: lo que sabes antes que el banco** |
| `8c10c8d` | «Hoy tienes» ya descuenta lo que diste por pagado |

La de la tarjeta es la importante, y la lección es de método: el dueño dijo
«te he importado el Excel, ¿qué no ves ahí? debería estar claro», y lo estaba.
Se habían hecho tres arreglos suponiendo cómo funcionaba su tarjeta y los tres
estaban mal. Abrir los dos extractos y compararlos dio la regla entera.

La del buzón salió de probar lo anterior: al meter sus extractos en la página
de pruebas, la aplicación intentó subir al buzón real sin mezclar antes. No
llegó a salir nada, pero el fallo era de la aplicación.

Disney+ y HBO Max: el banco escribe `PAYPAL *DISNEYPLUS` y la semilla de
PayPal los tragaba a los dos, distinguidos sólo por el precio. Ahora tienen
semilla propia antes que PayPal. Su `reciboId` pasó de `paypal#7`/`paypal#5`
a `disney`/`hbo-max`: lo que el dueño hubiera decidido sobre los viejos queda
huérfano.

El IBI de octubre: de ese plazo sólo hay una vista (octubre de 2025) y
`admitibles` lo daba por perdido **el mismo día que vencía**, porque pedía
`sumarMeses(fecha, 12) > hoy`. Ahora usa `GRACIA.anual` (25 días). Al dueño se le
contestó primero que eran «otros impuestos» y no: insistió y tenía razón.

El aviso «tu saldo se pone en negativo el 24 de noviembre» que sale con sus
datos **es real**, no un fallo: manda 968 € al mes a MyInvestor (500 el día 1
y 468 el 10) y en septiembre fraccionó los 468.

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

Repasado el 1 de octubre, 324 pruebas en verde, cero dependencias. El dueño
decidió qué se hace y qué no; respétalo:

**Le toca a él**, no al código:

- Probar el **modo avión** en el móvil: Playwright no ejecuta service workers.
- Marcar **Holaluz** como «ya no lo pago»: su compañía de luz ahora es Octopus.
- Abrir «Compras» y «Sin clasificar» en Categorías y mover lo mal puesto.
- Volver a marcar lo que tuviera decidido sobre Disney+ y HBO Max.

**Pendiente, sin prisa:**

1. **La primera compra normal con la tarjeta**, sin fraccionar: comprobar con
   el extracto en qué liquidación cae. Todo lo visto hasta hoy era fraccionado.
2. **Informes** mensual, trimestral y anual, y **salud financiera**: están en la
   especificación y no se han empezado.
3. **Que el aviso de saldo negativo diga qué lo arregla** («si te saltas la
   aportación de octubre a MyInvestor no llegas a cero»). Es la idea que más
   se parece a lo que la aplicación quiere ser.
4. **«Personas» sigue mezclando lo que te devuelven.** Quizá baste con estirar
   `devueltos` a los bizums sueltos.
5. **Verificar con datos reales** que un periodo cerrado cuadra al céntimo.
6. **Las barras pequeñas del simulador cuestan de agarrar.** No volver a un
   techo por barra.
7. `worker/.wrangler/cache/wrangler-account.json` sigue en el historial
   público (id de cuenta y correo, no una clave). Sacarlo exige reescribir el
   historial con `--force`, y eso es decisión del dueño.
8. **Tres buzones probablemente huérfanos** en el KV: `bf1fc9f5…`, `b77b60f3…` y
   `5326cffb…`, escritos la noche del 28 al probar contraseñas. El bueno es
   `607741a6…`. No se borraron por si alguno es el de un aparato que no se ha
   vuelto a abrir: Ajustes enseña los ocho primeros caracteres del buzón de
   cada aparato. Caducan solos en septiembre de 2027. El de pruebas
   (`aaaa…`) ya se borró.

**Decidido que no:** borrar recibos apuntados a mano (`quitarManual` existe y
no tiene botón; el dueño no lo quiere). Y **sincronizar sola con el banco**: ni
PSD2 con el Sabadell (vía agregador tipo Enable Banking, el worker vería los
movimientos en claro) ni con el usuario de Fintonic (sin API, habría que guardar
su contraseña y va contra sus condiciones). Se queda el Excel del Sabadell.

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
