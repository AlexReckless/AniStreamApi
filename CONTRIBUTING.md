# Contribuir a Anime1v API & Downloader Engine

¡Primero que todo, gracias por considerar contribuir a este proyecto! 🎉

Nos enorgullece decir que **hemos alcanzado más de 110 estrellas y 20 forks en GitHub**, ¡y todo es gracias a la fantástica comunidad que nos apoya! 🚀

Este documento es una guía para ayudarte a entender cómo puedes contribuir de forma efectiva al desarrollo, mantenimiento y mejora continua de **Anime1v API**.

## 🧠 Filosofía del Proyecto

Anime1v API es una herramienta 100% Open Source creada por **[FxxMorgan](https://github.com/FxxMorgan/)**. Nuestro objetivo es proveer una API y un motor de descargas robusto, libre y sin limitaciones comerciales para la comunidad. 

> **Nota importante sobre los créditos:** 
> Eres libre de modificar, extender y adaptar este código. Sin embargo, como muestra de respeto al trabajo original, te pedimos que mantengas intactas las firmas de autoría (headers, consola y README) de FxxMorgan, tal como se especifica en nuestra licencia.

## 🛠️ Cómo puedes ayudar

Hay muchas formas de contribuir a Anime1v API, ¡no solo escribiendo código!

1. **Reportar Bugs:** Si algo falla (ej. problemas con las protecciones Anti-Bot de AnimeFLV, fallas en la resolución de videos, errores en descargas HLS), abre un issue detallando cómo reproducir el error.
2. **Sugerir Funcionalidades:** ¿Nuevo proveedor de anime? ¿Nuevo servidor de video (ej. Mega)? ¡Abre un issue y lo discutimos!
3. **Mejorar la Documentación:** Corregir errores tipográficos, agregar ejemplos o traducir secciones siempre es bienvenido.
4. **Enviar Pull Requests (PRs):** Arreglar bugs conocidos, agregar soporte para nuevos sitios de streaming o mejorar la lógica de scraping y bypassing.

##  Entorno de Desarrollo Local

Si vas a contribuir con código, sigue estos pasos para configurar tu entorno:

1. **Haz un Fork** del repositorio a tu cuenta de GitHub (¡gracias por sumarte a los 20+ forks!).
2. **Clona** tu fork de manera local:
   ```bash
   git clone https://github.com/TU_USUARIO/anime1v-api.git
   cd anime1v-api
   ```
3. **Instala las dependencias**, incluyendo puppeteer si vas a probar sitios con protección JS:
   ```bash
   npm install
   npm install puppeteer
   ```
4. **Configura el entorno:**
   ```bash
   cp .env.example .env
   ```
   (Ajusta el `.env` a tus necesidades, activando `DEBUG_DOWNLOAD=true` para diagnosticar la resolución de enlaces si estás trabajando en el scraper).

5. **Crea una rama (branch)** para tu funcionalidad o corrección:
   ```bash
   git checkout -b feature/nuevo-proveedor
   # o
   git checkout -b fix/error-descarga-1fichier
   ```

##  Estándares de Código y Scraping

Dado que este proyecto hace peticiones a sitios de terceros, es vital seguir estos estándares para evitar bloqueos y mantener la estabilidad de la API. 

No se aceptarán PRs que no cumplan estas reglas de calidad:

### 1. Evasión y Rendimiento (Puppeteer)
Cuando uses Puppeteer para saltar protecciones (Cloudflare, captchas, fingerprinting), siempre garantiza que la instancia del navegador se cierre usando bloques `try...finally`. 

Los navegadores "zombis" (instancias no cerradas) colapsarán la memoria del servidor.

**Ejemplo Correcto:**
```javascript
const puppeteer = require('puppeteer');
const ApiError = require('../utils/api-error');

async function scrapeProtectedSite(url) {
  let browser;
  try {
    browser = await puppeteer.launch({ 
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    
    //  Inyectar User-Agent para evadir bloqueos
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');
    
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    
    // Tu lógica de extracción aquí...
    const title = await page.evaluate(() => document.title);
    return title;
  } catch (error) {
    throw new ApiError(`Error extrayendo datos con Puppeteer: ${error.message}`, 500);
  } finally {
    if (browser) {
      await browser.close(); // ¡CRÍTICO! Siempre cerrar el navegador
    }
  }
}
```

### 2. Manejo Centralizado de Errores
Nunca dejes que un error de scraping "crashee" la aplicación de Node.js. 

Usa siempre la clase `ApiError` u otra estructura de error manejable.

**Ejemplo Incorrecto :**
```javascript
// Esto crasheará el servidor si la red falla o el proveedor cambia el HTML
const response = await axios.get(url);
if (!response.data) throw new Error("No hay datos");
```

**Ejemplo Correcto :**
```javascript
const axios = require('axios');
const ApiError = require('../utils/api-error'); // Ajusta la ruta según el archivo

async function fetchData(url) {
  try {
    const response = await axios.get(url, { timeout: 10000 });
    if (!response.data) {
      throw new ApiError("Respuesta vacía del proveedor", 404);
    }
    return response.data;
  } catch (error) {
    // Preservar errores de la API si ya existen
    if (error instanceof ApiError) throw error;
    // Envolver errores de red (ej. timeout de axios)
    throw new ApiError(`Fallo de conexión al proveedor: ${error.message}`, 502);
  }
}
```

### 3. Filtros Anti-Fake (Validación de Videos)
Muchos servidores (como StreamWish o VOE) sirven videos "señuelo" (como Big Buck Bunny o test-videos) cuando detectan solicitudes automatizadas. 

Siempre asegúrate de no devolver archivos `.mp4` basura a los usuarios.

Si construyes un nuevo resolver, valídalo rigurosamente.

### 4. Convenciones de Nombrado y Comentarios
- **Variables y Funciones:** Utiliza `camelCase` (ej. `extractVideoUrl`).
- **Archivos:** Utiliza `kebab-case` (ej. `anime-service.js`).
- **Comentarios:** Es obligatorio documentar las expresiones regulares (Regex) complejas para que otros desarrolladores entiendan qué se está extrayendo.

```javascript
// Correcto: Explica qué extrae la Regex
// Extrae el ID del episodio. Ej: de "/ver/naruto-episodio-1" obtiene "naruto-episodio-1"
const episodeIdRegex = /\/ver\/([^/]+)/;
```


##  Proceso para enviar un Pull Request (PR)

1. Asegúrate de probar tu código exhaustivamente usando el **CLI interactivo v2** (`node descargador.js`) y/o los endpoints de la API (`npm run dev`).
2. Realiza commits descriptivos. Ejemplo: `feat: agrega soporte para servidor X` o `fix: corrige extracción de URL en TioAnime`.
3. Haz push de tu rama a tu fork:
   ```bash
   git push origin tu-nueva-rama
   ```
4. Abre un **Pull Request** en el repositorio principal, explicando detalladamente los cambios realizados. Si cierra algún issue, menciónalo (ej. `Closes #12`).

## Dudas o Consultas

Si tienes problemas técnicos al implementar algo o no estás seguro de por dónde empezar, puedes abrir una discusión o un issue en el repositorio etiquetado con `help wanted` o `question`.

---

¡Nuevamente, gracias por formar parte de esta comunidad y ayudarnos a llegar a las **110 estrellas**! Tu contribución ayuda a mantener esta herramienta viva, actualizada y libre para todos. ❤️
