# Cambios

## 0.3.0

- Todo lo que dependía de un usuario ahora es una opción (`/config` o `/plugin configure`): ubicación, idioma (`auto` sigue el `LANG` del sistema; español e inglés), formato de hora (24h/12h), fecha y ciclo de renovación (mensual o anual), mostrar u ocultar la renovación, y los umbrales de aviso y de crítico.
- Los datos guardados van por cuenta: quien usa más de una cuenta (`/login`) no ve el uso de la otra. Los datos de versiones anteriores se toman una vez.
- Planes Team y Enterprise: la renovación nunca se estima (la paga la organización).
- Windows: el archivo de configuración también se busca en `USERPROFILE`.
- La zona horaria y la cuenta se vuelven a leer cada hora (cambio de horario, `/login`).
- Cuando falta espacio, el aviso de una ventana que se agota es lo último que se recorta.
- `/mk-usage` acepta las ubicaciones en español o en inglés (`pie`/`footer`, `franja`/`band`, `oculto`/`hidden`).

## 0.2.x

- Bloques con nombre (`Sesión 5h │ Semana │ Renueva`), estimación al reinicio y detalle a pedido con `/mk-usage`.
- Vuelve al pie, la línea bajo el prompt, sin fila propia; la fila con colores sobre el prompt queda como opción.
- Sin glifos de ancho ambiguo (`↻`, `→`), que en algunas fuentes se pisaban con el carácter siguiente.

## 0.1.0

- Primera versión: ventanas de 5 h y 7 días, reinicios, renovación y proyección de agotamiento.
