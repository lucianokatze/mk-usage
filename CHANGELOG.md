# Changelog

Todos los cambios importantes de mk-usage quedan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa [Versionado Semántico](https://semver.org/lang/es/). Cómo se publica una versión: [README, Versiones](./README.md#versiones).

## [Unreleased]

### Added

- El estado de git y GitHub en una fila sobre el prompt, con los colores del tema según el estado:
  - la rama;
  - los cambios (preparados, modificados, nuevos, en conflicto, stash, una operación a medias);
  - la sincronía con el remoto;
  - el CI del PR o de la rama;
  - la versión: último tag, commits sin publicar, versión pendiente y aviso de `CHANGELOG sin tocar`.

  Se relee después de cada herramienta que toca archivos, al final de cada turno y cada `git_refresh_seconds`. GitHub se consulta con `gh`.
- Un diálogo de commit (`/mk-usage commit`, o la tecla `c` en la franja):
  - un borrador en Conventional Commits armado sin tokens;
  - el botón opcional «Generar con Claude», que gasta tokens solo al apretarlo;
  - el commit directo, o por la herramienta Bash con los hooks del repositorio.
- `/mk-usage git pie|franja|oculto` para mover la fila de git, y `/mk-usage actualizar` para releer git y GitHub al momento.
- Las opciones `git_placement`, `git_refresh_seconds`, `git_github`, `git_github_minutes`, `git_changelog_file`, `git_tag_pattern`, `git_commit_style`, `git_commit_ai`, `git_commit_model` y `git_commit_via`.
- El detalle de `/mk-usage` suma git y GitHub: upstream, archivos, último commit, versión, PR, cada check que falla o corre, y la URL del PR.

### Fixed

- El texto del pie ya no se corta con `…`:
  - cuando Claude Code muestra su badge `PR #N`, ahora se cuenta su espacio;
  - cuando no entra ni la forma más corta, se muestran menos ventanas, o ninguna.
- El texto del pie se suma al que agregan otros mods, en vez de reemplazarlo.

## [0.3.0] - 2026-10-12

Primera versión publicada. Las 0.1 y 0.2 fueron internas: lo que traían está acá.

### Added

- Los límites del plan al final de la línea bajo el prompt, en bloques con nombre (`Sesión 5h │ Semana │ Renueva`), sin filas extra y sin gastar tokens.
- La estimación de cada ventana al ritmo actual: el % al que llega al reiniciarse, o cuándo se agota antes.
- La fecha de renovación de la suscripción, mensual o anual, y una estimación marcada con `≈` cuando no está configurada. En planes Team y Enterprise nunca se estima, porque paga la organización.
- El detalle a pedido con `/mk-usage`, en un panel que se cierra con `Esc`.
- `/mk-usage pie|franja|oculto` (o `footer|band|hidden`) para cambiar la ubicación. La franja sobre el prompt usa los colores del tema.
- Opciones en `/config` y `/plugin configure`: ubicación, idioma, formato de hora, fecha y ciclo de renovación, mostrar u ocultar la renovación, y los umbrales de aviso y de crítico.
- Español e inglés. `auto` sigue el idioma del sistema.
- Los datos guardados van por cuenta, así que quien usa más de una (`/login`) no ve el uso de la otra.
- Windows: el archivo de configuración también se busca en `USERPROFILE`.
- La zona horaria y la cuenta se vuelven a leer cada hora.
- Cuando falta espacio, los bloques se recortan por partes, y el aviso de una ventana que se agota es lo último que se pierde.

[Unreleased]: https://github.com/lucianokatze/mk-usage/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/lucianokatze/mk-usage/releases/tag/v0.3.0
