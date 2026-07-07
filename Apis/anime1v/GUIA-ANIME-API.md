

### 401 Unauthorized
-  API Key inválida o expirada
-  Verifica que estés enviando el header `X-API-Key`

### 429 Too Many Requests
-  Límite de rate excedido
-  Espera hasta el reset o upgrade tu plan

### 404 Not Found
-  URL del anime no existe
-  Verifica la URL en animeav1.com

### 500 Internal Server Error
-  Sitio cambió su estructura
-  Reporta el problema

---

##  Documentación Adicional

- **[API Reference Completa](anime-scraper-api.md)** - Todos los endpoints
- **[Filtro Mega](MEGA-FILTER-INFO.md)** - Documentación del filtro
- **[Changelog](CAMBIOS-ANIMEAV1.md)** - Historial de cambios
- **[Ejemplos](ejemplo-anime-api.js)** - Código de ejemplo

---

##  Uso Avanzado

### Workflow Completo

```javascript
const API_KEY = 'tu_key';
const BASE = 'http://localhost:3001/api/v1/anime';

async function descargarAnime(nombre) {
  // 1. Buscar
  const search = await fetch(`${BASE}/search?q=${nombre}&domain=animeav1.com`, {
    headers: { 'X-API-Key': API_KEY }
  });
  const { data: { results } } = await search.json();
  
  // 2. Obtener info
  const info = await fetch(`${BASE}/info?url=${results[0].url}`, {
    headers: { 'X-API-Key': API_KEY }
  });
  const anime = await info.json();
  
  console.log(`${anime.data.title} - ${anime.data.totalEpisodes} episodios`);
  
  // 3. Obtener enlaces del primer episodio
  const ep = await fetch(`${BASE}/episode?url=${anime.data.episodes[0].url}`, {
    headers: { 'X-API-Key': API_KEY }
  });
  const links = await ep.json();
  
  console.log('Enlaces SUB:', links.data.servers.sub);
  console.log('Enlaces DUB:', links.data.servers.dub);
}

descargarAnime('naruto');
```

---

##  Soporte

-  **Email**: contact@fxxmorgan.me
-  **Web**: [https://localhost:3001](https://localhost:3001)
-  **Docs**: [GitHub](https://github.com/FxxMorgan/anime1v-api)
-  **Issues**: Reporta problemas con la API

---

##  Términos de Uso

-  Uso personal y educativo permitido
-  Respeta el rate limiting
-  No abuses de la API
-  No revender accesos
-  No hacer scraping de la API

---

**Powered by FxxMorgan** | API Version 1.0.0

```bash
npm install youtube-dl-exec
# o
npm install @distube/ytdl-core
```

### 3. Almacenamiento en la Nube

```bash
npm install @aws-sdk/client-s3
# o
npm install @google-cloud/storage
```

### 4. Procesamiento de Video

```bash
npm install fluent-ffmpeg
```

##  Configuración de Descarga Real

Para implementar descarga real de videos, puedes usar:

### Opción 1: youtube-dl

```javascript
const youtubedl = require('youtube-dl-exec');

async function downloadVideo(url, outputPath) {
  await youtubedl(url, {
    output: outputPath,
    format: 'bestvideo+bestaudio',
  });
}
```

### Opción 2: Puppeteer + Interceptar Requests

```javascript
const puppeteer = require('puppeteer');

async function extractVideoUrl(pageUrl) {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  const videoUrls = [];
  
  page.on('request', request => {
    if (request.resourceType() === 'media') {
      videoUrls.push(request.url());
    }
  });
  
  await page.goto(pageUrl);
  await browser.close();
  
  return videoUrls;
}
```

##  Límites de la API

Recuerda que cada plan tiene límites:

- **Free**: 100 requests/día, 5 descargas/día
- **Premium**: 1000 requests/día, 50 descargas/día
- **Enterprise**: 10000 requests/día, descargas ilimitadas

## ️ Consideraciones Legales

**IMPORTANTE**: El scraping puede violar términos de servicio de algunos sitios.

- Solo úsalo para **fines educativos**
- Respeta el `robots.txt` de los sitios
- No sobrecargues los servidores
- Considera el copyright del contenido

##  Debugging

Si tienes problemas:

1. Verifica que el sitio esté accesible
2. Inspecciona el HTML real del sitio
3. Ajusta los selectores CSS
4. Revisa los logs del servidor
5. Usa herramientas como Postman para probar

##  Soporte

Para más ayuda, revisa:
- Documentación de Cheerio: https://cheerio.js.org/
- Documentación de Puppeteer: https://pptr.dev/
- Documentación de Axios: https://axios-http.com/
