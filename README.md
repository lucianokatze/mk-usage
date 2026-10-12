# mk-usage

[![CI](https://github.com/lucianokatze/mk-usage/actions/workflows/ci.yml/badge.svg)](https://github.com/lucianokatze/mk-usage/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/lucianokatze/mk-usage)](https://github.com/lucianokatze/mk-usage/releases)
[![Licencia MIT](https://img.shields.io/github/license/lucianokatze/mk-usage)](./LICENSE)

Un mod de [Claude Code](https://code.claude.com/docs/es/plugins/mods/overview) que te deja siempre a la vista dos cosas.

**Debajo del prompt, los límites de tu plan de Claude:**
- cuánto usaste de cada uno;
- con cuánto vas a llegar al reinicio si seguís al ritmo actual;
- cuándo se renueva tu suscripción.

**Sobre el prompt, el estado de git y GitHub del proyecto,** en una fila que cambia de color según lo que pasa:
- la rama y los cambios sin commitear;
- lo que falta subir o bajar;
- el CI de tu PR;
- la versión y si el CHANGELOG está al día.

Desde esa fila hacés el commit con un mensaje que arma el mod, o que escribe Claude si se lo pedís.

No gasta tokens, salvo que aprietes «Generar con Claude». Se adapta al ancho de la ventana.

```
main  │  2 preparados · 1 modificado  │  subir 2  │  CI ok  │  v0.3.0 +4 sin publicar · CHANGELOG sin tocar   c: commit
╭─────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ ❯                                                                                                               │
╰─────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents · Sesión 5h 49% (~95%) │ Semana 51% (se agota ~23h)
```

## Qué es cada bloque

### El uso de Claude (debajo del prompt)

| Bloque | Qué mide |
| :- | :- |
| **Sesión 5h** | El límite de sesión: se reinicia cada 5 horas. |
| **Semana** | El límite semanal de todos los modelos; se reinicia a una hora fija de la semana. Si tu plan tiene un límite semanal aparte para algún modelo, aparece como otro bloque (por ejemplo `Semana Fable`). Detrás de un gateway con límite de gasto aparece `Gasto`. |
| **Renueva** | Cuándo se renueva y se cobra la suscripción. **No es una cuota**: los planes de Claude no tienen límite mensual, solo los de sesión y de semana ([plan Max](https://support.claude.com/en/articles/11049741-what-is-the-max-plan), [Claude Code con Pro o Max](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan)). |

Junto a cada porcentaje va la estimación: `(~95%)` o `· ~95% al reinicio` es el % que tendrías al reiniciarse la ventana, y `se agota ~23h` avisa que se acaba antes.

### Git y GitHub (sobre el prompt)

Solo aparece cuando la sesión trabaja dentro de un repositorio git.

| Bloque | Qué dice |
| :- | :- |
| **Rama** | La rama actual en negrita, con el color del peor estado de la fila. Si no hay rama, `HEAD separado`; si todavía no hay commits, `sin commits`. |
| **Cambios** | `preparados` (en el índice), `modificados`, `nuevos` (sin seguir), `en conflicto`, `en stash`, o `limpio`. Si quedó a medias un merge, rebase, cherry-pick, revert o bisect, lo dice. |
| **Sincronía** | Contra el upstream: `subir 2`, `bajar 1` o `al día`. Sin upstream: `3 sin subir` (commits que no están en ningún remoto) o `rama sin subir`. Sin remoto: `sin remoto`. |
| **CI** | Los checks del PR de la rama, o los últimos workflows de la rama si no tiene PR: `CI ok`, `CI corriendo 1/3` o `CI falla 1/3`. También avisa `PR fusionado`. El número de PR y el estado de la revisión no se repiten, porque Claude Code ya los muestra en el pie ([PR review status](https://code.claude.com/docs/en/interactive-mode#pr-review-status)). |
| **Versión** | El último tag (`v0.3.0`) y los commits que vinieron después (`+4 sin publicar`). Si la versión del manifiesto (`.claude-plugin/plugin.json` o `package.json`) es más nueva que el tag, dice `v0.4.0 pendiente`. Si hay commits sin publicar y el CHANGELOG no cambió desde el tag, dice `CHANGELOG sin tocar`. |

**Los colores** son los de tu tema:

| Color | Cuándo |
| :- | :- |
| error (rojo) | conflictos, CI que falla, rama divergida (hay para subir y para bajar) |
| advertencia (amarillo) | cambios sin commitear, commits para subir o bajar, una operación a medias, HEAD separado, CHANGELOG sin tocar |
| sugerencia (azul claro) | CI corriendo, versión pendiente de publicar |
| éxito (verde, azul en temas para daltonismo) | limpio, al día, CI ok |
| gris | archivos nuevos, stash, sin remoto, commits sin publicar, checks de un commit anterior |

## Instalación

Necesitás Claude Code v2.1.287 o posterior, que trae los mods activados por defecto. Este mod se escribió y se probó con la v2.1.296. Los límites solo existen en los planes Pro y Max (o detrás de un gateway con límite de gasto); con una clave de API no hay nada que mostrar.

**Desde GitHub**, en una sesión de Claude Code:

```
/plugin install mk-usage --marketplace lucianokatze/mk-usage
```

Respondé `y` para agregar el marketplace y elegí el alcance (`user`, para todas tus sesiones). Después configurá la fecha de renovación (ver [Configuración](#configuración)).

**Para actualizarlo:** `/plugin marketplace update mk-usage` dentro de una sesión, o `claude plugin update mk-usage@mk-usage` desde la terminal. Para que se actualice solo, entrá a **Marketplaces** en `/plugin`, elegí `mk-usage` y activá **Enable auto-update**. Cada versión nueva cambia `version` en `plugin.json`: Claude Code solo baja una copia nueva cuando ese número cambia.

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

Las opciones de git y GitHub empiezan con `git_`:

| Opción | Valores | Por defecto | Qué hace |
| :- | :- | :- | :- |
| `git_placement` | `band`, `footer`, `hidden` | `band` | Dónde va la fila de git: sobre el prompt con colores, al final de la línea bajo el prompt (en gris, después del uso), o solo en el detalle. |
| `git_refresh_seconds` | 5 a 600 | `20` | Cada cuánto se relee el repositorio. Además se relee después de cada herramienta que toca archivos y al final de cada turno. Si `git status` tarda más de 2 s dos veces, deja de contar los archivos nuevos y se relee 4 veces menos. |
| `git_github` | `auto`, `off` | `auto` | Consultar el PR y el CI con [`gh`](https://cli.github.com). Hace falta `gh` instalado y con sesión (`gh auth login`); si no, la fila sigue sin CI y el detalle dice por qué. |
| `git_github_minutes` | 1 a 60 | `3` | Cada cuánto se consulta GitHub. Mientras hay checks corriendo, cada 30 s; después de un `git push` o un `gh pr`, enseguida y otra vez a los 10 y 30 s. |
| `git_changelog_file` | un archivo | `CHANGELOG.md` | El archivo del aviso `CHANGELOG sin tocar`. Vacío desactiva el aviso. |
| `git_tag_pattern` | un patrón | `v[0-9]*` | Qué tags cuentan como versiones publicadas. |
| `git_commit_style` | `conventional`, `plain` | `conventional` | El estilo del borrador y de lo que escribe Claude: [Conventional Commits](https://www.conventionalcommits.org/es/v1.0.0/) (`feat(hooks): …`) o una frase. |
| `git_commit_ai` | `true`, `false` | `true` | Mostrar el botón «Generar con Claude» en el diálogo de commit. |
| `git_commit_model` | un modelo | `haiku` | El modelo de «Generar con Claude»: un alias (`haiku`, `sonnet`, `opus`) o un id. |
| `git_commit_via` | `auto`, `bash`, `direct` | `auto` | Cómo se hace el commit. `direct` lo hace el mod con git: es instantáneo, pero Claude Code corre el git de los mods sin los hooks del repositorio. `bash` lo hace con la herramienta Bash, con sus permisos y con los hooks (`pre-commit`, `commit-msg`). `auto` usa `bash` solo si el repositorio tiene hooks propios. |

## Comandos

Ningún comando escribe en la conversación ni gasta tokens: responden con un aviso emergente o abren un panel.

- **`/mk-usage`** abre el detalle en un panel, y `Esc` lo cierra:
  ```
  Max 5x · renueva el 2 nov (en 21 d)
  Sesión 5h  49%  ~95% al reinicio
    reinicia 15:00 (en 2h26m) · ritmo 19%/h
  Semana     51%  se agota en ~23h (mañana 11:34)
    reinicia mié 14 21:00 (en 2d8h) · ritmo 51%/día

  Git · mk-usage · feat/git
    sigue a origin/feat/git · subir 2
    2 preparados · 1 modificado
    último commit 3f2a1bc hace 12m: feat(git): estado en la franja
    v0.3.0 · 4 commits sin publicar · v0.4.0 pendiente · CHANGELOG.md al día
  GitHub
    PR #2: Git y GitHub en la franja
    checks de 3f2a1bc: 1 ok, 1 corriendo
      corriendo  Validar y probar
    https://github.com/lucianokatze/mk-usage/pull/2
  ```
- **`/mk-usage commit`**, o la tecla `c` con la franja enfocada (`ctrl+x tab` o un clic), abre el diálogo de commit:
  - muestra los archivos preparados, y con **Preparar todo** suma los demás (`git add -A`);
  - el **Título** viene con un borrador armado a partir de los archivos, sin tokens: `docs:` si son solo documentos, `test:`, `ci:`, `build:`, `chore(release): vX.Y.Z` si va el CHANGELOG con el manifiesto, y si no `feat:` o `fix:`, con la carpeta común como scope. El **Cuerpo** es opcional;
  - **Generar con Claude** le pasa a Claude los últimos 10 títulos del repositorio, el resumen de archivos y el diff preparado (hasta 24 KB, sin lockfiles), y completa los campos para que los revises. Es lo único del mod que gasta tokens, solo cuando lo apretás, y el aviso dice cuántos usó;
  - **Confirmar** (o `Enter` en un campo) hace el commit; **Cancelar** o `Esc` cierra sin hacer nada.

  Si abriste el diálogo desde la franja, `ctrl+x tab` le pasa el teclado.
- **`/mk-usage actualizar`** vuelve a leer git y GitHub al momento, y reintenta GitHub si antes faltaba `gh` o la sesión.
- **`/mk-usage pie|franja|oculto`** mueve el uso de Claude, y **`/mk-usage git pie|franja|oculto`** la fila de git. También acepta `footer`, `band`, `hidden` y `off`. La elección se guarda para todas las sesiones, hasta que cambies la opción en la configuración: gana lo último que hiciste.

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

La fila de git, cuando falta espacio:
1. junta los archivos en `N cambios` (los conflictos siempre aparte);
2. acorta la versión (`v0.3.0+4`);
3. saca las cuentas del CI;
4. saca la versión, el stash y el botón de commit;
5. deja solo lo que pide atención;
6. por último, la rama, cortada con `..` si hace falta, y los problemas, el peor primero.

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
- **Git:** el mod corre `git` en tu máquina, en la carpeta de la sesión, sin red: `rev-parse`, `status --porcelain=v2`, `config --get-regexp` (los remotos), `describe`, `log -1`, `diff --quiet` del CHANGELOG y `rev-list --count` si la rama no tiene upstream. Corre sin locks opcionales (`GIT_OPTIONAL_LOCKS=0`), así que no compite con tu propio git. Solo mira los códigos de salida, nunca textos traducidos.
- **GitHub:** `gh pr view` y, si la rama no tiene PR, `gh run list`, con tu sesión de `gh`. No corre si el remoto no es de GitHub, si `git_github` es `off` o si está `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`.
- **Claude:** solo «Generar con Claude» llama al modelo, con `$.model.complete`. El diff preparado se manda al modelo y cuenta para los límites de tu plan.
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
│   ├── usage.ts           lógica pura del uso: estimación, renovación, preferencias, armado de la línea
│   ├── git.ts             lógica pura de git y GitHub: lo que imprimen git y gh, tonos, la fila, el detalle
│   ├── commit.ts          lógica pura del commit: borrador, pedido a Claude, mensaje
│   └── words.ts           todos los textos, por idioma
├── types/index.d.ts       el contrato de $.state del mod
├── tests/                 claude plugin test
├── scripts/
│   └── release-notes.sh   imprime las notas de una versión desde el CHANGELOG
└── .github/workflows/
    └── ci.yml             valida, prueba y publica las versiones
```

```bash
claude plugin validate .   # manifiesto, marketplace, hooks y llamadas
claude plugin test .       # tests/*.test.ts(x)
```

Para chequear los tipos se usa el archivo `claude-code.d.ts` de tu versión. Claude Code lo escribe en `.claude-plugin/types/` al cargar el mod desde una carpeta que recarga en caliente, o junto al skill `plugin-authoring` cuando se carga. Con ese archivo: `tsc -p .`, o un `tsconfig.json` cuyo `include` lo nombre junto a `hooks`, `types` y `tests`.

**Para agregar un idioma:** sumá una tabla en `hooks/words.ts`, su código en `Language` y su detección en `languageOf`, y la opción en `language` dentro de `plugin.json`.

## Versiones

Cada versión está en [CHANGELOG.md](./CHANGELOG.md) y en las [releases](https://github.com/lucianokatze/mk-usage/releases). El proyecto usa [Versionado Semántico](https://semver.org/lang/es/): mientras sea 0.x, la versión menor sube con funciones nuevas y la de parche con arreglos.

**Para publicar una versión:**

1. Los cambios entran por un PR a `master`, con commits en el formato de [Conventional Commits](https://www.conventionalcommits.org/es/v1.0.0/) (`feat: …`, `fix: …`, `docs: …`), y cada uno suma su línea en `## [Unreleased]` del CHANGELOG.
2. Al cerrar una versión, un commit `chore(release): vX.Y.Z` sube `version` en `.claude-plugin/plugin.json` y cambia `## [Unreleased]` por `## [X.Y.Z] - AAAA-MM-DD`, con su enlace al pie.
3. El CI ([`ci.yml`](./.github/workflows/ci.yml)) valida el mod y corre los tests en cada PR y en cada push a `master`, y frena una versión sin notas en el CHANGELOG. Cuando `master` recibe una versión que todavía no tiene release, la publica: crea el tag `vX.Y.Z` con las notas de esa sección (`scripts/release-notes.sh X.Y.Z` las muestra).

Claude Code solo les baja una copia nueva a quienes lo instalaron cuando cambia `version`: los cambios sin versión nueva quedan en el repositorio hasta la próxima.

## Licencia

[MIT](./LICENSE)
