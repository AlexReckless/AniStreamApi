const axios = require("axios");
const cheerio = require("cheerio");
const { ApiError } = require("../../utils/api-error");

const BASE_URL = "https://manga-oni.com";

const HTML_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  Referer: BASE_URL,
};

async function fetchHtml(url) {
  try {
    const timeout = Number(process.env.REQUEST_TIMEOUT_MS || 15000);
    const response = await axios.get(url, {
      timeout,
      headers: HTML_HEADERS,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400,
    });
    return response.data;
  } catch (error) {
    throw new ApiError(500, "No se pudo obtener contenido de MangaOni", error.message);
  }
}

// Tipo tal como aparece en la URL (/manga/, /manhwa/, ...) -> codigo numerico
// que usa el <select name="tipo"> del formulario de /directorio. Verificado
// en vivo contra manga-oni.com/directorio (view-source del formulario real).
const TIPO_URL_TO_CODE = { manga: "0", manhwa: "1", oneshot: "2", manhua: "3", novela: "4" };
const TIPOS_VALIDOS = Object.keys(TIPO_URL_TO_CODE);

function parseTipoSlugFromUrl(url) {
  const match = String(url || "").match(/manga-oni\.com\/([a-z]+)\/([^/?#]+)\/?/i);
  if (!match) return null;
  const [, tipo, slug] = match;
  if (!TIPOS_VALIDOS.includes(tipo.toLowerCase())) return null;
  return { tipo: tipo.toLowerCase(), slug };
}

// ════════════════════════════════════════════════════════════
// Construccion de URLs (puro, sin red) -- lo usa tanto el fetch
// server-side de mas abajo como el endpoint /mangaoni/fetch-url,
// que le dice al celular que URL pedir el cuando Render esta bloqueado.
// ════════════════════════════════════════════════════════════
function buildCatalogUrl(page = 1, options = {}) {
  const { tagIds = [], sort = null } = options;
  const params = new URLSearchParams();
  const pageNum = Number(page) || 1;
  if (pageNum > 1) params.set("p", String(pageNum));

  const generoId = Number(tagIds[0]);
  if (Number.isFinite(generoId)) params.set("genero", String(generoId));

  // Siempre adulto=0 (mismo default del propio sitio) para que esta fuente
  // se mantenga fuera del contenido +18 -- se registra como nsfw:false.
  params.set("adulto", "0");

  if (sort === "az") {
    params.set("filtro", "nombre");
    params.set("orden", "asc");
  } else if (sort === "za") {
    params.set("filtro", "nombre");
    params.set("orden", "desc");
  }

  return `${BASE_URL}/directorio?${params.toString()}`;
}

function buildSearchUrl(query) {
  if (!query) {
    throw new ApiError(400, "El parametro de busqueda 'q' es requerido");
  }
  // /buscar (sin slash, param "s") solo redirige al home -- es el buscador
  // "en vivo" (dropdown, JS). El endpoint real de resultados es /buscar/?q=.
  return `${BASE_URL}/buscar/?q=${encodeURIComponent(query)}`;
}

function buildInfoUrl(tipo, slug) {
  if (!tipo || !slug || !TIPOS_VALIDOS.includes(tipo)) {
    throw new ApiError(400, "Se requiere 'tipo/slug' del manga (ej: manga/one-piece)");
  }
  return `${BASE_URL}/${tipo}/${slug}/`;
}

function buildChapterUrl(slug, chapterId) {
  if (!slug || !chapterId) {
    throw new ApiError(400, "Se requiere 'slug' y 'chapterId' del capitulo");
  }
  return `${BASE_URL}/lector/${slug}/${chapterId}/cascada/`;
}

// ════════════════════════════════════════════════════════════
// Parseo (puro, sin red) -- reutilizable tanto si el HTML lo trajo
// axios (fetchHtml de aca abajo) como si lo trajo la app desde el
// celular del usuario (endpoint /mangaoni/parse).
// ════════════════════════════════════════════════════════════

// Cada carta de listado (directorio o busqueda, mismo template en ambas) es
// un <a itemprop="url" href=".../{tipo}/{slug}/"> que contiene un
// <img itemprop="image" alt="Titulo" data-src="portada"> (lazy-load real via
// data-src, el src trae solo un placeholder) y, como hermano de texto, la
// linea "AÑO - AUTOR". Verificado en vivo -- ninguna clase CSS usada aca es
// de las hasheadas/obfuscadas del build, todo es por atributo semantico.
// "id" se guarda como el tipo (no un id numerico) porque el resto de la app
// arma mangaPath como `${item.id}/${item.slug}`, y para esta fuente esa ruta
// tiene que ser literalmente "{tipo}/{slug}" (asi es la URL real del sitio).
function parseCatalogHtml(html) {
  const $ = cheerio.load(html);
  const items = [];
  const seen = new Set();

  $('a[itemprop="url"]').each((_, el) => {
    const href = $(el).attr("href") || "";
    const parsed = parseTipoSlugFromUrl(href);
    if (!parsed) return;

    const key = `${parsed.tipo}/${parsed.slug}`;
    if (seen.has(key)) return;
    seen.add(key);

    const img = $(el).find("img").first();
    const title = (img.attr("alt") || "").trim();
    if (!title) return;
    const cover = img.attr("data-src") || img.attr("src") || null;

    const rawText = $(el).text().replace(/\s+/g, " ").trim();
    const yearAuthorMatch = rawText.match(/(\d{4})\s*-\s*(.+)$/);

    items.push({
      id: parsed.tipo,
      slug: parsed.slug,
      title,
      cover,
      rating: null,
      type: parsed.tipo,
      year: yearAuthorMatch ? yearAuthorMatch[1] : null,
      autor: yearAuthorMatch ? yearAuthorMatch[2].trim() : null,
      url: href,
      source: "mangaoni",
    });
  });

  // El sitio marca el link "Siguiente" de la paginacion con rel="next"
  // (semantica HTML estandar) -- mas confiable que contar paginas a mano.
  const hasNextPage = $('a[rel="next"]').length > 0;

  return { items, hasNextPage };
}

// mangaPath tiene la forma "{tipo}/{slug}" (asi la arma parseCatalogHtml de
// arriba y asi la pasa la ruta /manga/:source/*).
function parseInfoHtml(html, tipo, slug) {
  const $ = cheerio.load(html);

  const title = $(".post-title").first().text().trim() || $("h1").first().text().trim();
  if (!title) {
    throw new ApiError(404, "Manga no encontrado en MangaOni");
  }

  // Generos: <div id="categ"><a title="Clic para ver mas mangas de X">X</a>...
  const genres = $("#categ a")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);

  // Portada: <img alt="Titulo" src=".../cover.jpg?..."> (resolucion completa,
  // sin lazy-load en esta pagina).
  const cover = $('img[src*="/cover"]').first().attr("src") || null;

  // Autor/Fecha/Estado/Ranking viven en #info-i como <strong>Label:</strong> Valor,
  // separados por <br> (sin salto de linea real en el texto plano de cheerio).
  const infoText = $("#info-i").text().replace(/\s+/g, " ").trim();
  const autorMatch = infoText.match(/Autor:\s*(.*?)\s*Fecha:/);
  const anioMatch = infoText.match(/Fecha:\s*(\d+)/);
  const estado = $("#desarrollo").text().trim() || null;
  const ranking = $("#ranking").text().trim() || null;

  // Sinopsis: <div id="sinopsis"><h3>Sinopsis</h3>texto...</div>
  const synopsis = $("#sinopsis").text().replace(/^\s*Sinopsis\s*/i, "").trim();

  // Capitulos: <div id="c_list"><a href=".../lector/{slug}/{id}/">
  //   <span class="timeago" data-num="N">...</span><h3 class="entry-title-h2">Capitulo N — Sub</h3>
  // </a>
  // uploadId se guarda como "{slug}/{id}" (con slash) porque, a diferencia de
  // tmohentai/simplyhentai, la pagina del lector de MangaOni necesita el slug
  // del manga ademas del id del capitulo -- la ruta /chapter/:source/* usa un
  // wildcard, asi que un uploadId con slash adentro llega intacto (mismo
  // truco que ya usa simplyhentai.service.js con "{seriesSlug}/{slug}").
  const chapters = [];
  const seenChapters = new Set();
  $("#c_list a").each((_, el) => {
    const href = $(el).attr("href") || "";
    const m = href.match(/\/lector\/[^/]+\/(\d+)/);
    if (!m) return;
    const chapterId = m[1];
    if (seenChapters.has(chapterId)) return;
    seenChapters.add(chapterId);

    const numAttr = $(el).find(".timeago").attr("data-num");
    const number = numAttr && Number.isFinite(Number(numAttr)) ? Number(numAttr) : null;
    const chapterTitle =
      $(el).find(".entry-title-h2").text().trim() || (number ? `Capítulo ${number}` : "Capítulo");

    chapters.push({ number, uploadId: `${slug}/${chapterId}`, title: chapterTitle });
  });
  chapters.sort((a, b) => (a.number || 0) - (b.number || 0));

  return {
    id: tipo,
    slug,
    title,
    year: anioMatch ? anioMatch[1] : null,
    synopsis,
    cover,
    genres,
    autor: autorMatch ? autorMatch[1].trim() : null,
    estado,
    ranking,
    chapters,
    url: buildInfoUrl(tipo, slug),
    source: "mangaoni",
  };
}

// uploadId tiene la forma "{slug}/{chapterId}" (ver comentario en parseInfoHtml).
//
// Las imagenes NO vienen como <img src="..."> en el HTML: la pagina del
// lector (modo "cascada") trae un <script>var unicap = 'BASE64';</script>
// que al decodificar en base64 da: "{baseUrl}||{JSON array de nombres}||".
// Verificado en vivo decodificando un capitulo real de One Piece.
function parseChapterHtml(html, uploadId) {
  const cleanPath = String(uploadId || "").replace(/^\/+/, "");

  const match = html.match(/var\s+unicap\s*=\s*'([^']+)'/);
  if (!match) {
    throw new ApiError(404, "No se encontraron paginas para este capitulo");
  }

  let decoded;
  try {
    decoded = Buffer.from(match[1], "base64").toString("utf-8");
  } catch (_error) {
    throw new ApiError(500, "No se pudo decodificar las paginas del capitulo");
  }

  const separatorIdx = decoded.indexOf("||");
  const baseImgUrl = separatorIdx >= 0 ? decoded.slice(0, separatorIdx) : "";
  const arrayRaw = separatorIdx >= 0 ? decoded.slice(separatorIdx + 2).replace(/\|\|$/, "") : "";

  let filenames = [];
  try {
    filenames = JSON.parse(arrayRaw);
  } catch (_error) {
    filenames = [];
  }

  const pages = (Array.isArray(filenames) ? filenames : [])
    .map((name) => (baseImgUrl && name ? `${baseImgUrl}${name}` : null))
    .filter(Boolean);

  if (pages.length === 0) {
    throw new ApiError(404, "No se encontraron paginas para este capitulo");
  }

  const $ = cheerio.load(html);
  const title = $("#c_list option[selected]").text().trim() || $("title").text().trim();

  return { uploadId: cleanPath, pages, title };
}

// ════════════════════════════════════════════════════════════
// Fetch server-side (build + fetchHtml + parse) -- interfaz que
// espera el dispatcher generico de manga.routes.js (getSource().service).
// Solo funciona si Render no esta bloqueado por Cloudflare para este
// sitio; si lo esta, la app usa en cambio /mangaoni/fetch-url +
// /mangaoni/parse para que el HTML lo traiga el celular del usuario.
// ════════════════════════════════════════════════════════════
async function searchContent(query) {
  const html = await fetchHtml(buildSearchUrl(query));
  return parseCatalogHtml(html).items;
}

async function getCatalog(page = 1, options = {}) {
  const html = await fetchHtml(buildCatalogUrl(page, options));
  return parseCatalogHtml(html);
}

async function getMangaInfo(mangaPath) {
  const [tipo, slug] = String(mangaPath || "").split("/").filter(Boolean);
  const html = await fetchHtml(buildInfoUrl(tipo, slug));
  return parseInfoHtml(html, tipo, slug);
}

async function getChapterPages(uploadId) {
  const cleanPath = String(uploadId || "").replace(/^\/+/, "");
  const [slug, chapterId] = cleanPath.split("/").filter(Boolean);
  if (!slug || !chapterId) {
    throw new ApiError(400, "uploadId invalido (se espera 'slug/chapterId')");
  }
  const html = await fetchHtml(buildChapterUrl(slug, chapterId));
  return parseChapterHtml(html, cleanPath);
}

module.exports = {
  TIPOS_VALIDOS,
  searchContent,
  getCatalog,
  getMangaInfo,
  getChapterPages,
  buildCatalogUrl,
  buildSearchUrl,
  buildInfoUrl,
  buildChapterUrl,
  parseCatalogHtml,
  parseInfoHtml,
  parseChapterHtml,
};
