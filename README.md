# mk-usage

Un mod de [Claude Code](https://code.claude.com/docs/es/plugins/mods/overview) que muestra, al final de la línea que está debajo del prompt, los límites de tu plan de Claude:
- cuánto usaste de cada uno;
- con cuánto vas a llegar al reinicio si seguís al ritmo actual;
- cuándo se renueva tu suscripción.

No agrega filas a la terminal, no gasta tokens y se adapta al ancho de la ventana.

```
❯
─────────────────────────────────────────────────────────────────────────────────────────────────────────
  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents · Sesión 5h 49% (~95%) │ Semana 51% (se agota ~23h)
```

## Qué es cada bloque

| Bloque | Qué mide |
| :- | :- |
| **Sesión 5h** | El límite de sesión: se reinicia cada 5 horas. |
| **Semana** | El límite semanal de todos los modelos; se reinicia a una hora fija de la semana. Si tu plan tiene un límite semanal aparte para algún modelo, aparece como otro bloque (por ejemplo `Semana Fable`). Detrás de un gateway con límite de gasto aparece `Gasto`. |
| **Renueva** | Cuándo se renueva y se cobra la suscripción. **No es una cuota**: los planes de Claude no tienen límite mensual, solo los de sesión y de semana ([plan Max](https://support.claude.com/en/articles/11049741-what-is-the-max-plan), [Claude Code con Pro o Max](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan)). |

Junto a cada porcentaje va la estimación: `(~95%)` o `· ~95% al reinicio` es el % que tendrías al reiniciarse la ventana, y `se agota ~23h` avisa que se acaba antes.

## Instalación

Necesitás Claude Code v2.1.287 o posterior, que trae los mods activados por defecto. Este mod se escribió y se probó con la v2.1.296. Los límites solo existen en los planes Pro y Max (o detrás de un gateway con límite de gasto); con una clave de API no hay nada que mostrar.

**Desde GitHub**, en una sesión de Claude Code:

```
/plugin install mk-usage --marketplace <usuario>/mk-usage
```

Respondé `y` para agregar el marketplace y elegí el alcance (`user`, para todas tus sesiones). Después configurá la fecha de renovación (ver [Configuración](#configuración)).

**Desde una copia local** (por ejemplo, para desarrollarlo):

```bash
claude plugin marketplace add <ruta-a>/mk-usage
claude plugin install mk-usage@mk-usage --scope user --config renewal_date=AAAA-MM-DD
```

Un marketplace que es una carpeta local se lee desde la carpeta misma: después de editar el mod, alcanza con `/reload-plugins` en la sesión abierta.

## Configuración

Cada opción aparece en `/config` y en `/plugin configure mk-usage@<marketplace>`. Desde la terminal también se pueden pasar con `--config clave=valor` al instalar.

| Opción | Valores | Por defecto | Qué hace |
| :- | :- | :- | :- |
| `placement` | `footer`, `band`, `hidden` | `footer` | Dónde se muestra: al final de la línea bajo el prompt (sin fila propia, en el gris de Claude), en una fila propia sobre el prompt (con los colores del tema), o en ningún lado (solo el detalle con `/mk-usage`). |
| `language` | `auto`, `es`, `en` | `auto` | `auto` sigue el idioma del sistema (`LC_ALL`, `LC_MESSAGES` o `LANG`): español si empieza con `es`, inglés si no. |
| `time_format` | `24h`, `12h` | `24h` | `15:00` o `3:00pm`. |
| `renewal_date` | `AAAA-MM-DD` o `DD/MM/AAAA` | vacía | La fecha de tu próxima renovación tal como la muestra claude.ai. Se repite según `billing_period`. Si la dejás vacía, se estima con la fecha de alta de tu suscripción y se marca con `≈`. Esa estimación puede fallar si cambiaste de plan, y nunca se hace en planes Team o Enterprise, porque ahí paga la organización. |
| `billing_period` | `monthly`, `yearly` | `monthly` | Cada cuánto se repite la renovación. |
| `show_renewal` | `true`, `false` | `true` | Desactivalo si no pagás vos la suscripción o no te interesa verla. |
| `warn_percent` | 1 a 100 | `85` | Una ventana que llega a este % al reiniciarse, o que ya lo superó, se marca como justa. |
| `critical_percent` | 1 a 100 | `95` | Una ventana que supera este %, o que se agota antes de reiniciarse, se marca como crítica. Nunca queda por debajo de `warn_percent`. |

## Comandos

Ningún comando escribe en la conversación ni gasta tokens: responden con un aviso emergente.

- **`/mk-usage`** abre el detalle en un panel, y `Esc` lo cierra:
  ```
  Max 5x · renueva el 2 nov (en 21 d)
  Sesión 5h  49%  ~95% al reinicio
    reinicia 15:00 (en 2h26m) · ritmo 19%/h
  Semana     51%  se agota en ~23h (mañana 11:34)
    reinicia mié 14 21:00 (en 2d8h) · ritmo 51%/día
  ```
- **`/mk-usage <ubicación>`** cambia la ubicación al momento. Acepta `pie`/`footer`, `franja`/`band` y `oculto`/`hidden`/`off`. La elección se guarda para todas las sesiones, hasta que cambies `placement` en la configuración: gana lo último que hiciste.

## Cómo se adapta al ancho

Ocupa solo el espacio que queda después de las indicaciones de Claude, y nunca corta un bloque a la mitad. Cuando falta espacio, recorta en este orden:
1. las horas de reinicio;
2. las palabras de la estimación (queda `(~95%)`);
3. la renovación;
4. las estimaciones de las ventanas que vienen bien, y después las de las justas.

Lo último que se pierde es el aviso de una ventana que se agota, en su forma más corta (`agota ~23h`).

| Ancho | Después de `← for agents ·` |
| :- | :- |
| ~150 columnas | `Sesión 5h 49% · ~95% al reinicio │ Semana 51% · se agota en ~23h │ Renueva en 21 d` |
| ~120 | `Sesión 5h 49% (~95%) │ Semana 51% (se agota ~23h)` |
| ~100 | `Sesión 5h 50% │ Semana 51% (agota ~23h)` |

**Colores.** Claude dibuja la línea de abajo del prompt en su propio gris y descarta los colores de cualquier mod, así que ahí el estado se lee en las palabras. Con `placement` en `band`, la fila propia muestra el porcentaje en negrita con el color de tu tema: el de éxito si llegás bien al reinicio, el de advertencia si vas justo y el de error si se agota antes. En los temas para daltonismo, éxito se ve azul.

## La estimación

Para cada ventana: `p` es el % usado, `R` el momento del reinicio y `L` la duración de la ventana (5 h o 7 días).

1. **Ritmo reciente.** Es la pendiente, por mínimos cuadrados, de las muestras de la última hora (ventana de 5 h) o del último día (ventana semanal), sumando el momento actual, así que si hacés una pausa el ritmo baja. Hacen falta 3 puntos que cubran al menos 10 minutos (5 h) o 2 horas (semana).
2. **Ritmo medio,** cuando todavía no hay muestras suficientes: lo usado dividido por el tiempo desde que abrió la ventana, `p / (ahora − (R − L))`.
3. **Tiempo hasta agotarla:** `(100 − p) / ritmo`. Si es antes de `R`, dice cuándo se agota. Si no, el % al que llegarías: `p + ritmo · (R − ahora)`.

Los tiempos se redondean (`~2h`, `~35m`) para que el texto no cambie a cada rato.

## De dónde salen los datos

- **Cuota:** `$.session.usage()` y el evento `session.measure` de la API de mods dan las mismas cifras que recibe la status line (`rate_limits`). Leerlas es gratis y no llama al modelo. Llegan **con la primera respuesta de cada sesión**; hasta entonces se muestra el último dato guardado de tu cuenta, con su antigüedad si pasa de 15 minutos.
- **Plan y cuenta:** se leen de `.claude.json`, que está en `CLAUDE_CONFIG_DIR` o en tu carpeta personal (`HOME`, o `USERPROFILE` en Windows). El mod solo toma el tipo de plan, la fecha de alta y el identificador de la cuenta. Es un archivo interno de Claude Code: si cambia o no se puede leer, el plan no aparece y el resto sigue funcionando. **El mod nunca lee las credenciales.**
- **Hora local:** sale del sistema. Si el runtime de mods informa UTC, el mod ejecuta `date +%z` para conocer tu zona horaria; la zona y la cuenta se vuelven a leer cada hora.
- **Almacenamiento:** las muestras y el último dato se guardan en el almacén del mod (`~/.claude/plugins/store/`), separados por cuenta, y los comparten todas tus sesiones abiertas de esa cuenta.

## Desarrollo

```
mk-usage/
├── .claude-plugin/
│   ├── plugin.json        manifiesto y opciones (userConfig)
│   └── marketplace.json   para instalarlo desde este repositorio
├── hooks/
│   ├── hooks.json         apunta al módulo de hooks
│   ├── register.tsx       hooks y llamadas a la API de mods
│   ├── usage.ts           lógica pura: estimación, renovación, preferencias, armado de la línea
│   └── words.ts           todos los textos, por idioma
├── types/index.d.ts       el contrato de $.state del mod
└── tests/                 claude plugin test
```

```bash
claude plugin validate .   # manifiesto, marketplace, hooks y llamadas
claude plugin test .       # tests/*.test.ts(x)
```

Para chequear los tipos se usa el archivo `claude-code.d.ts` de tu versión. Claude Code lo escribe en `.claude-plugin/types/` al cargar el mod desde una carpeta que recarga en caliente, o junto al skill `plugin-authoring` cuando se carga. Con ese archivo: `tsc -p .`, o un `tsconfig.json` cuyo `include` lo nombre junto a `hooks`, `types` y `tests`.

**Para agregar un idioma:** sumá una tabla en `hooks/words.ts`, su código en `Language` y su detección en `languageOf`, y la opción en `language` dentro de `plugin.json`.

## Licencia

[MIT](./LICENSE)
