# Bajamar

Cuánto te queda en el punto más bajo del mes.

**[jcaboroca.github.io/Bajamar](https://jcaboroca.github.io/Bajamar/)** — se
instala desde el navegador y luego funciona sin red.

El total de un mes no sirve para decidir nada. Si la nómina entra el 25 y el
recibo gordo sale el 1, lo que importa no es cerrar en positivo: es no quedarte
en descubierto el día 10. Bajamar calcula ese mínimo —el punto más bajo al que
llega tu saldo antes de que vuelva a entrar dinero— y el día exacto en que
ocurre.

Lee los extractos que exportas tú mismo desde la web de tu banco. No se conecta
a ninguna entidad, no tiene cuenta, no tiene servidor y no hace una sola
petición de red. Todo ocurre y se queda en tu navegador.

## Cómo se usa

```sh
npm run dev      # sirve la aplicación en http://localhost:4173
npm test         # 279 pruebas, sin dependencias
```

No hay `npm install` porque no hay nada que instalar: **cero dependencias**,
ni de producción ni de desarrollo. Tampoco hay paso de compilación. Lo que se
escribe es lo que se ejecuta.

Desde la web del banco, exporta los movimientos en formato Excel y suelta el
fichero en la ventana. Puedes soltar varios a la vez —la cuenta y la tarjeta— y
volver a soltar el mismo más adelante: los identificadores son deterministas, así
que reimportar actualiza en lugar de duplicar.

## Qué hace

- **La bajamar.** Proyecta día a día: saldo actual, menos el ritmo de gasto
  ordinario, más y menos todo lo que se sabe que viene. Devuelve el mínimo.
- **Lo que viene.** Distingue lo confirmado de lo previsto y lo dice.
- **No lo sé.** Lo que ha aparecido una o dos veces no se da por hecho: se
  pregunta.
- **En qué se va.** Reparto por categorías, con lo que no encaja visible como
  «sin clasificar» en vez de escondido.
- **Y en qué quieres que se vaya.** Lo que queda después de los recibos se
  reparte entre categorías, y ese reparto es el que mueve la previsión. «Este
  mes menos comer fuera» deja de ser un propósito y pasa a ser una cifra: se ve
  al momento cuánto sube el punto más bajo.

## Dos dispositivos

Exportas el extracto en el ordenador y quieres verlo en el móvil. Eso obliga a
que los datos pasen por algún sitio, así que pasan cerrados: **se cifran en tu
navegador antes de salir** (AES-GCM, con la clave derivada de tu contraseña por
PBKDF2), y la contraseña no viaja nunca. Quien transporte o guarde el paquete
recibe ruido.

Sin configurar nada, *Enviar cifrado* te descarga un fichero `.bajamar` que
pasas al otro dispositivo como quieras y abres allí con la misma contraseña.

Si quieres que sea automático, monta el buzón de [worker/](worker/src/index.js):

```sh
npm run buzon
```

Crea el almacén, despliega el worker y deja su dirección en
[config.js](config.js). Necesita una cuenta de Cloudflare —el plan gratuito
sobra— y la primera vez abrirá el navegador para que le des acceso. Después,
`git push`: lo que publica la web es lo que usa el móvil.

El buzón es deliberadamente tonto: guarda bytes que no entiende. No hay cuentas
ni tokens porque **el identificador del buzón también se deriva de tu
contraseña**, con una sal distinta de la del cifrado. Quien la sabe, encuentra
el buzón; quien no, no puede ni adivinar la dirección, y si la adivinara se
llevaría un sobre que no abre.

Una advertencia que conviene leer dos veces: **no hay recuperación**. Si olvidas
la contraseña, lo que hay en el buzón no lo abre nadie, yo incluido. Esa es la
propiedad que hace que valga la pena, y también el riesgo.

## Cinco decisiones que explican el resto

**El desajuste se enseña, no se cuadra solo.** Repartes 620 € y al día siguiente
importas el extracto y aparece un cargo de 40 € que no esperabas. La aplicación
no encoge tus categorías para que la suma vuelva a cuadrar: te dice que te
quedan 40 € menos y decides tú de dónde salen. Un reparto que se corrige a tus
espaldas es la aplicación gastando tu dinero por ti.

**El importe esperado es la mediana, nunca la media.** Con 50 · 55 · 70 la media
dice 58 y el último valor dice 70. La mediana dice 55, que es lo que de verdad
cuesta. Una sola factura rara desplaza una media y la deja inservible para
predecir.

**Con dos apariciones no se infiere una periodicidad, salvo que no quede lugar
a duda.** Dos fechas dan un solo intervalo, y un intervalo de 365 días no
distingue un seguro anual de dos visitas al mismo bar con un año de diferencia.
Por eso lo normal es que vaya a la lista de preguntas, no a la de certezas. La
excepción es lo anual cuando las dos coinciden en día del año y en precio, y el
importe es de los que se notan: ahí la prueba es más dura que la que se le pide
a un recibo mensual. Y un cobrador que ya ha demostrado dos veces que factura en
fechas fijas arrastra consigo sus otros plazos, mientras su turno no haya
pasado.

**Un mismo cobrador puede tener varias series.** El ayuntamiento cobra el IBI, la
basura y el vado por separado. Promediarlos da una cifra que no corresponde a
ningún recibo real. Cuando el conjunto no tiene un ritmo propio, se parte por
importe y se busca el ritmo de cada parte.

**Un recibo domiciliado cae siempre el mismo día del mes; una costumbre no.**
Cinco compras en meses seguidos de invierno tienen intervalos que parecen
mensuales. Comprobar la coherencia del día del mes es lo que separa un
compromiso de una racha estacional.

## Por qué cero dependencias

El lector de `.xls` está escrito aquí: OLE2 en [src/importar/ole2.js](src/importar/ole2.js)
y BIFF8 en [src/importar/biff.js](src/importar/biff.js). Son unas 350 líneas.

La alternativa era `xlsx` de npm, abandonada en la versión 0.18.5 y con dos
vulnerabilidades sin parchear: contaminación de prototipo (CVE-2023-30533) y
denegación de servicio por expresión regular (CVE-2024-22363). En una aplicación
cuya única promesa es que tus datos no salen de tu equipo, cargar un analizador
vulnerable de 800 KB para leer dos ficheros es incoherente. Escribirlo cuesta
menos y se entiende entero.

## Estructura

```
src/
  importar/    ole2.js · biff.js · xls.js · sabadell.js
  dominio/     dinero.js (céntimos enteros) · tipos.js (fechas)
  entidades/   limpiar.js · semillas.js · reconciliar.js
  analisis/    periodos.js · compromisos.js · bajamar.js · cascada.js · plan.js
  almacen/     db.js (IndexedDB) · cifrado.js · sincro.js
  ui/          app.js · lamina.js · clave.js · estilo.css
worker/        el buzón, opcional
scripts/
  servir.mjs             servidor estático de desarrollo
  informe.mjs            el análisis completo en texto
  validar-lector.mjs     vuelca la rejilla de un .xls
  validar-importacion.mjs comprueba invariantes contra ficheros reales
```

El dinero son siempre **céntimos enteros**. Ningún importe pasa por un `float`
más allá del instante en que se lee del fichero, porque `2839.15 * 100` da
`283914.99999999994`.

## Bancos

Ahora mismo reconoce dos plantillas del Banco Sabadell: el extracto de cuenta
(«Consulta de movimientos») y el de tarjeta («Saldos y movimientos»). Añadir otro
banco es escribir un analizador nuevo en `src/importar/` que devuelva la misma
forma; el resto de la aplicación no se entera de dónde vienen los datos.

## Si vas a tocarlo

[docs/diseno/ESTADO.md](docs/diseno/ESTADO.md) cuenta por dónde va, qué
invariantes no hay que romper y las trampas del entorno. Lo importante que no
se adivina leyendo el código: **un mes no es un mes natural, es el periodo
entre dos nóminas**.

## Licencia

MIT.
