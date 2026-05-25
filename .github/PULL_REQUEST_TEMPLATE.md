## Descripción
<!-- Describe aquí brevemente qué hace este Pull Request y por qué es necesario. -->

## Tipo de cambio
<!-- Marca con una 'x' las opciones que apliquen -->
- [ ] Bugfix (corrección de errores que no rompe funcionalidades existentes)
- [ ] Nueva característica (nueva funcionalidad que no rompe funcionalidades existentes)
- [ ] Cambio de ruptura (fix o feature que causaría que la funcionalidad existente no funcione como se esperaba)
- [ ] Actualización de documentación

## ¿Cómo ha sido probado?
<!-- Por favor describe las pruebas que realizaste para verificar tus cambios. -->
- [ ] Probado en el CLI interactivo v2 (`node descargador.js`)
- [ ] Probado mediante los endpoints de la API localmente (`npm run dev`)
- [ ] Verificado que **NO** se generen navegadores zombis (Puppeteer `browser.close()`)
- [ ] Validado con descargas reales (los videos no son *Big Buck Bunny* ni falsos)

## Checklist (Lista de Verificación):
- [ ] Mi código sigue fielmente los **Estándares de Código y Scraping** dictados en `CONTRIBUTING.md`.
- [ ] He revisado mi propio código antes de enviar el PR.
- [ ] He documentado las expresiones regulares (Regex) y la lógica de evasión compleja.
- [ ] He utilizado `ApiError` para capturar errores sin crashear el servidor.
