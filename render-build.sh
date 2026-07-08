#!/usr/bin/env bash
# Build command para Render. Fija PUPPETEER_CACHE_DIR (definido como variable
# de entorno del servicio en el dashboard de Render) a una ruta persistente
# antes de instalar dependencias, para que Puppeteer descargue Chrome ahi y lo
# encuentre despues al arrancar. Sin esto, Render suele perder el Chrome
# descargado entre el build y el arranque del servicio ("Chrome executable
# not found").
set -o errexit

npm install
