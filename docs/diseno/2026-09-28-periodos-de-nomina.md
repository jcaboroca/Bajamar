# El mes deja de ser el mes natural

## Qué cambia

Hoy la aplicación usa **mes natural más un desplazamiento contable**: septiembre
va del 1 al 30, y una nómina cobrada a partir del día 20 se apunta al mes
siguiente aunque el dinero entre el 25. De ahí salen tres conceptos
(`DIA_DE_ADELANTO`, `mesContableDe`, el conjunto `abrenMes`), una segunda línea
en la gráfica para enseñar «este dinero ya no es de septiembre», y un tramo de
diez días en que hay dos meses vivos a la vez.

A partir de aquí el mes **es el periodo entre dos nóminas**. Septiembre va del
25 de agosto al 24 de septiembre, porque el 25 de agosto entró el dinero con el
que se vive septiembre. El 25 de septiembre entra la siguiente y con ella
empieza octubre.

No es un ajuste: es quitar el parche y arreglar la definición.

## Qué se borra

- **El desplazamiento entero.** `DIA_DE_ADELANTO`, `mesContableDe`,
  `mesContable`, `mesDeUnMovimiento` y `abrenMes` desaparecen. Dentro de un
  periodo no hay nada que reasignar: la nómina que lo abre ya está dentro.
- **La segunda línea de la lámina.** Existía para enseñar qué parte del saldo
  no era de este mes. Ahora todo el saldo del periodo es del periodo.
- **Los dos meses vivos.** Del día 20 a fin de mes había uno que se vivía y
  otro que se planificaba. Ahora sólo hay uno, siempre: el que va corriendo.
- **La contradicción entre Resumen y Previsión**, que venía de que cada uno
  usaba una definición distinta de «este mes».

## El periodo

**Definición.** Un periodo empieza el día en que entra la nómina y acaba el día
anterior a la siguiente. El día en que llega el dinero pertenece ya al periodo
que abre. Los periodos encajan sin solaparse y sin dejar huecos.

**Nombre.** El del mes en que cae su último día. El periodo 25-ago → 24-sep se
llama septiembre. La regla funciona también cuando la nómina se mueve: 31-ago →
29-sep sigue siendo septiembre.

**Quién corta.** Los cobros de las entidades que hoy alimentan `abrenMes`: las
categorizadas como nómina, y si no hay ninguna, el mayor ingreso recurrente. Ese
conjunto no se tira, cambia de papel: ya no dice qué se desplaza, dice qué
corta.

**Periodos pasados.** Los cortes son las fechas reales de las nóminas del
extracto. Si un mes cobraste el 23 porque el 25 era domingo, ese periodo dura
dos días menos y se dice.

**Periodos futuros.** Los cortes son las fechas previstas del compromiso de
ingreso. Un periodo futuro dura lo que diga la previsión.

**Casos que hay que resolver y no se pueden dejar al azar:**

- *No hay nómina detectada.* Se cae a meses naturales y se avisa una vez: «no
  he reconocido una nómina, así que cuento por meses naturales». Sin nómina no
  hay periodo de nómina; fingirlo sería peor.
- *El primer periodo del extracto está cortado.* Empieza donde empiezan los
  datos, no en una nómina. Se marca como incompleto y no se usa para medir
  costumbre.
- *Dos nóminas en el mismo mes* (una paga extra, un atraso). Corta la que
  coincide con el ritmo habitual; la otra es un ingreso más dentro del periodo.
  Si las dos encajan en el ritmo, corta la primera.
- *Un mes sin nómina.* El periodo se alarga hasta la siguiente que haya. Un
  periodo de 60 días es raro y por eso se dice, pero es la verdad.

## El Resumen

Tres bloques y un selector de periodo arriba. Nada más.

**1 · ¿Llego?** La bajamar del periodo en grande —la única cifra de 104 px—,
la fecha en que ocurre, y la lámina justo debajo. Una sola línea, la del banco.

**2 · ¿Cuánto tengo para vivir, y a qué ritmo?** La cascada resumida: lo que
cobras, lo comprometido, y lo que queda. Con el ritmo diario al lado y la
comparación contra lo que sueles gastar. Cifra mediana.

**3 · ¿Voy bien?** Lo repartido contra lo gastado, **sólo las categorías que se
desvían**. Si todo va en orden, una línea que lo diga.

Fuera del Resumen: la lista de movimientos del periodo (ya está en Movimientos),
el reparto con sus barras (se queda en Previsión), los dudosos (son una bandeja
de tareas, no un resumen) y el bloque de ahorro (es la resta de lo que ya se ve
en el bloque 2).

Los avisos siguen arriba, pero sólo aparecen si hay algo grave.

## Qué toca en el código

- **`cascada.js`** deja de exportar la regla del desplazamiento y pasa a
  exportar el cálculo de periodos: dada la lista de cobros que cortan y la
  previsión, devolver los periodos con su inicio, fin, nombre y si están
  completos.
- **`mes.js`** pierde `mesContable`, `mesDeUnMovimiento` y el parámetro
  `abrenMes` de `resumenDeMes` y `porMeses`. Todo lo que hoy pregunta «¿de qué
  mes es esto?» pasa a preguntar «¿de qué periodo es esto?», que es una
  comparación de fechas contra dos bordes.
- **`mensual.js`** cambia de eje: `curvaDelMes` pasa a recibir dos fechas en
  vez de un mes, y pierde la segunda serie.
- **`presupuestos.js`** agrega por periodo en vez de por mes natural.
- **`plan.js`** y el almacén `planes` se indexan por periodo. Los planes que ya
  existan se migran por nombre, que es el mismo.
- **`estado.js`** deja de calcular `abrenMes`, `mesesDeCuenta` y el parche del
  mes siguiente, y pasa a calcular la lista de periodos una vez.
- **Las vistas**: el Resumen se reduce a tres bloques; Previsión pierde su
  tabla mes a mes, que era la misma navegación que el Resumen ya tiene.

## Qué no entra aquí

- Reorganizar las pestañas. Sale de esto que Previsión se queda coja, pero es
  una decisión aparte y se toma después, con el Resumen ya funcionando.
- Tocar el lector de `.xls`, el cifrado ni el buzón.

## Pruebas

Lo que hay que dejar clavado antes de dar esto por hecho:

- Un periodo empieza el día de la nómina y acaba el día antes de la siguiente;
  ningún día cae en dos periodos ni se queda fuera de todos.
- El nombre sale del mes del último día, también cuando la nómina se mueve.
- Una nómina cobrada el 23 en vez del 25 acorta el periodo y no descoloca los
  siguientes.
- Un mes sin nómina alarga el periodo en vez de partirlo.
- Sin nómina detectada, se cae a meses naturales.
- El primer periodo del extracto sale marcado como incompleto.
- La bajamar de un periodo es el mínimo de su curva entre sus dos bordes.
- El gasto por categoría de un periodo cuenta los movimientos entre sus bordes,
  ni uno más.
- Un plan guardado antes del cambio sigue apareciendo en su periodo.
