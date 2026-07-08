# Requisitos — anime1v-api-main (Backend de scraping: anime, películas/series, manga)

## Sistema

- Node.js 18 LTS o superior (recomendado 20+).
- Google Chrome descargado para Puppeteer (ver nota abajo) — necesario solo para el módulo de películas/series, que scrapea sitios protegidos con Cloudflare/JS.
- Opcional pero recomendado: **yt-dlp** instalado y disponible en el `PATH` del sistema — se usa como resolvedor primario para obtener enlaces directos de video en el módulo de películas/series. Si no está instalado, la app sigue funcionando con los resolvedores de respaldo (más lentos/frágiles).

## Dependencias principales (`package.json`)

- `express`, `cors`, `helmet`, `morgan`, `dotenv`
- `axios`, `cheerio` (scraping HTML)
- `puppeteer` (scraping de sitios con JS/Cloudflare — módulo de películas)
- `ffmpeg-static`, `fluent-ffmpeg` (procesamiento de video para descargas)
- `cli-progress`, `prompts`, `unpacker`

Dev: `nodemon`

## Variables de entorno (`.env`)

Ya existe un `.env` en este proyecto (no se versiona su contenido real). Variables usadas:

| Variable | Para qué sirve |
|---|---|
| `PORT` | Puerto del servidor (default `3000` si no se define) |
| `NODE_ENV` | `development` / `production` |
| `API_KEYS` | Lista de API keys válidas separadas por coma, requeridas por el middleware `requireApiKey` en casi todos los endpoints |
| `DISABLE_AUTH` | Si es `true`, desactiva la validación de API key (solo para desarrollo local) |
| `DISABLE_RATE_LIMIT` | Si es `true`, desactiva el límite diario de requests |
| `DAILY_REQUEST_LIMIT` | Tope de requests diarios por API key cuando el rate limit está activo |
| `REQUEST_TIMEOUT_MS` | Timeout de las peticiones HTTP de scraping (axios) |
| `DOWNLOADS_DIR` | Carpeta donde se guardan los archivos descargados |
| `DOWNLOAD_REQUEST_TIMEOUT_MS` | Timeout específico para las descargas |
| `DEFAULT_ANIME_DOMAIN` | Dominio de anime usado por defecto cuando no se especifica `domain` en la búsqueda |
| `PUPPETEER_EXECUTABLE_PATH` | Ruta manual al ejecutable de Chrome, si Puppeteer no lo detecta solo |
| `MOVIES_MAX_CONCURRENT_PAGES` | (usado en `services/movies/browser.js`) cuántas pestañas de Puppeteer corren en paralelo para el módulo de películas |

## Instalación y ejecución

```bash
npm install
npm run dev     # con nodemon, recarga en caliente
# o
npm start       # produccion, sin nodemon
```

El servidor levanta en `http://localhost:<PORT>` (por defecto `3000`).

### Instalar el Chrome de Puppeteer

Si el módulo de películas/series falla con "Could not find Chrome", hay que instalarlo manualmente:

```bash
npx puppeteer browsers install chrome
```

**Nota de esta sesión (Windows):** en este entorno, el `unzip` de `npx puppeteer` a veces extrae el `.zip` de Chrome de forma incompleta (queda el `.zip` pero falta `chrome.exe`). Si eso pasa, extraer el zip manualmente con PowerShell:

```powershell
Expand-Archive -Path "<ruta al .zip en el cache de puppeteer>" -DestinationPath "<carpeta destino>" -Force
```

y mover el contenido a la carpeta que puppeteer espera (`%USERPROFILE%\.cache\puppeteer\chrome\<version>\chrome-win64\`).

## Notas

- El `README.md` de este proyecto documenta los endpoints con más detalle (proveedores de anime soportados, servidores de video soportados, límites conocidos por protecciones anti-bot).
- Varias fuentes de manga/películas están detrás de Cloudflare u otras protecciones anti-bot; algunas (ej. sitios bloqueados por reputación de IP del entorno donde corra el server) pueden requerir correr el backend desde una red residencial en vez de una IP de datacenter.
