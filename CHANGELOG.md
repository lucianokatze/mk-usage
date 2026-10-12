# Changelog

Todos los cambios importantes de mk-usage quedan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa [Versionado Semántico](https://semver.org/lang/es/). Cómo se publica una versión: [README, Versiones](./README.md#versiones).

## [Unreleased]

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
