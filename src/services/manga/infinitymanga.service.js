const axios = require("axios");
const cheerio = require("cheerio");
const { ApiError } = require("../../utils/api-error");

const BASE_URL = "https://www.infinitymanga.com";
const AJAX_URL = `${BASE_URL}/wp-admin/admin-ajax.php`;

// El sitio es WordPress con un theme propio ("mangaverse"), no Madara: no hay
// /manga/<slug>/ ni admin-ajax con action=wp-manga-search-manga. Las fichas
// viven en /es/manga/<slug>.html y los capitulos en /es/<manga-slug>/<cap-slug>.html.
const HTML_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
};

// El theme pagina el catalogo, la busqueda y la lista de capitulos via AJAX
// (wp-admin/admin-ajax.php, action=mangaverse_load_more) usando 10 posts por
// pagina y un nonce de WP embebido en cualquier pagina renderizada como
// `var mangaverse_ajax = {"ajax_url":...,"nonce":"...","current_lang":"es"};`.
// El nonce dura varias horas y no depende de cookies de sesion (usuario
// anonimo), asi que lo cacheamos en memoria y lo refrescamos cada 10 min.
const CHAPTER_PAGE_SIZE = 10;
const MAX_CHAPTER_AJAX_PAGES = 40; // limite duro de paginas extra por obra
const CHAPTER_FETCH_CONCURRENCY = 6;
const NONCE_TTL_MS = 10 * 60 * 1000;

let cachedNonce = null;
let cachedNonceAt = 0;

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
    throw new ApiError(500, "No se pudo obtener contenido de InfinityManga", error.message);
  }
}

async function fetchAjax(params) {
  try {
    const timeout = Number(process.env.REQUEST_TIMEOUT_MS || 15000);
    const response = await axios.post(AJAX_URL, new URLSearchParams(params).toString(), {
      timeout,
      headers: { ...HTML_HEADERS, "Content-Type": "application/x-www-form-urlencoded" },
      validateStatus: (status) => status >= 200 && status < 400,
    });
    return response.data;
  } catch (error) {
    throw new ApiError(500, "No se pudo obtener contenido de InfinityManga", error.message);
  }
}

function extractNonce(html) {
  const match = String(html || "").match(/var\s+mangaverse_ajax\s*=\s*(\{[\s\S]*?\});/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]).nonce || null;
  } catch (_error) {
    return null;
  }
}

async function ensureNonce() {
  const now = Date.now();
  if (cachedNonce && now - cachedNonceAt < NONCE_TTL_MS) return cachedNonce;
  const html = await fetchHtml(`${BASE_URL}/es/`);
  const nonce = extractNonce(html);
  if (nonce) {
    cachedNonce = nonce;
    cachedNonceAt = now;
  }
  return nonce;
}

function slugFromPath(mangaPath) {
  const withoutQuery = String(mangaPath || "").split(/[?#]/)[0];
  const parts = withoutQuery.split("/").filter(Boolean);
  const last = parts[parts.length - 1] || "";
  return last.replace(/\.html$/i, "");
}

// OJO IMPORTANTE: cuando la URL pedida (obra o capitulo) no existe, el sitio
// NO devuelve 404 -- WordPress hace un 302 "canonical redirect" hacia otra
// obra/capitulo cualquiera que SI existe (parece un fallback mal configurado,
// no busca por similitud de slug). axios sigue ese redirect solo y devuelve
// 200 con contenido real pero de otra obra distinta a la pedida. La unica
// forma de detectarlo es comparar el <link rel="canonical"> de la pagina
// obtenida contra la ruta que en realidad pedimos.
function getCanonicalPath(html) {
  const match = String(html || "").match(/<link rel="canonical" href="([^"]+)"/i);
  if (!match) return null;
  try {
    return new URL(match[1], BASE_URL).pathname.replace(/\/+$/, "").toLowerCase();
  } catch (_error) {
    return null;
  }
}

function matchesCanonical(html, expectedPath) {
  const canonical = getCanonicalPath(html);
  if (!canonical) return true; // sin canonical no podemos verificar, se deja pasar
  return canonical === expectedPath.replace(/\/+$/, "").toLowerCase();
}

// El uploadId que exponemos hacia afuera es "<manga-slug>/<capitulo-slug>"
// (sin ".html"), que es justo lo que hace falta para reconstruir la URL real
// /es/<manga-slug>/<capitulo-slug>.html.
function parseUploadId(uploadId) {
  const clean = String(uploadId || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\.html$/i, "");
  const parts = clean.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  return { mangaSlug: parts[0], chapterSlug: parts.slice(1).join("/") };
}

// Las tarjetas de obra (portada, catalogo y "Matching Series" de la busqueda)
// comparten exactamente el mismo markup: <div class="series-card"><a
// class="series-card-link" href=".../manga/<slug>.html">...<div
// class="series-card-thumb" style="background-image: url('...')">...<h3
// class="series-card-title">. La portada NO viene en un <img>, hay que
// sacarla del style inline.
function parseCatalogCards($) {
  const items = [];
  $(".series-card").each((_, el) => {
    const card = $(el);
    const a = card.find("a.series-card-link").first();
    const href = a.attr("href") || "";
    const match = href.match(/\/manga\/([^/]+)\.html/i);
    if (!match) return;

    const slug = match[1];
    const title = card.find(".series-card-title").first().text().trim();
    const style = card.find(".series-card-thumb").first().attr("style") || "";
    const coverMatch = style.match(/url\(['"]?([^'")]+)['"]?\)/i);
    const cover = coverMatch ? coverMatch[1] : "";

    if (slug && title && !items.some((i) => i.slug === slug)) {
      items.push({
        id: slug,
        slug,
        title,
        cover,
        rating: null,
        type: null,
        url: new URL(href, BASE_URL).href,
        source: "infinitymanga",
      });
    }
  });
  return items;
}

// OJO: cada capitulo se publica DOS veces como post de WordPress -- una vez
// con slug "...-capitulo-N.html" (ES) y otra con "...-chapter-N.html" (EN),
// aunque estemos parados en /es/. Descartamos la variante "-chapter-" para no
// listar cada capitulo por duplicado; si algun dia el sitio deja de duplicar
// esto simplemente no filtra nada.
function parseChapterArticles($) {
  const chapters = [];
  $("article.chapter-item a.chapter-link").each((_, el) => {
    const a = $(el);
    const href = a.attr("href") || "";
    if (!href || /-chapter-\d/i.test(href)) return;

    const withoutHtml = href.replace(/\.html$/i, "");
    const parts = withoutHtml.split("/").filter(Boolean);
    if (parts.length < 2) return;
    const mangaSlug = parts[parts.length - 2];
    const chapterSlug = parts[parts.length - 1];
    const uploadId = `${mangaSlug}/${chapterSlug}`;
    if (chapters.some((c) => c.uploadId === uploadId)) return;

    const numMatch = chapterSlug.match(/(\d+(?:\.\d+)?)(?:-[a-z0-9]+)*$/i);
    const label = a.find(".chapter-title").first().text().trim() || a.text().trim();

    chapters.push({
      number: numMatch ? Number(numMatch[1]) : null,
      uploadId,
      title: label || "Capítulo",
    });
  });
  return chapters;
}

async function getCatalog(page = 1) {
  const pageNum = Number(page) || 1;

  if (pageNum <= 1) {
    const html = await fetchHtml(`${BASE_URL}/es/`);
    const nonce = extractNonce(html);
    if (nonce) {
      cachedNonce = nonce;
      cachedNonceAt = Date.now();
    }
    const $ = cheerio.load(html);
    const items = parseCatalogCards($);
    // La home no informa un total ni un "has_more" explicito para la grilla
    // estatica; 20 tarjetas por pagina es el tamaño de pagina real del theme.
    return { items, hasNextPage: items.length >= 20 };
  }

  const nonce = await ensureNonce();
  if (!nonce) return { items: [], hasNextPage: false };

  const raw = await fetchAjax({
    action: "mangaverse_load_more",
    nonce,
    page: pageNum,
    type: "series_grid",
    lang: "es",
  });

  if (!raw || raw.success !== true || !raw.data || !raw.data.html) {
    return { items: [], hasNextPage: false };
  }

  const $ = cheerio.load(raw.data.html);
  return { items: parseCatalogCards($), hasNextPage: Boolean(raw.data.has_more) };
}

async function searchContent(query) {
  if (!query) {
    throw new ApiError(400, "El parametro de busqueda 'q' es requerido");
  }
  // Busqueda real server-side por GET: /es/?s=<query> devuelve una seccion
  // "Matching Series" (mismas .series-card que el catalogo) y otra de
  // capitulos sueltos que encontraron coincidencia; solo nos interesa la
  // primera para respetar el shape de obra que pide esta funcion.
  const url = `${BASE_URL}/es/?s=${encodeURIComponent(query)}`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  return parseCatalogCards($);
}

async function getMangaInfo(mangaPath) {
  const slug = slugFromPath(mangaPath);
  if (!slug) {
    throw new ApiError(400, "Se requiere el slug de la obra");
  }

  const url = `${BASE_URL}/es/manga/${slug}.html`;
  const html = await fetchHtml(url);

  if (!matchesCanonical(html, `/es/manga/${slug}.html`)) {
    throw new ApiError(404, "Obra no encontrada");
  }

  const $ = cheerio.load(html);

  const title = $(".series-title").first().text().trim();
  if (!title) {
    throw new ApiError(404, "Obra no encontrada");
  }

  const synopsis = $(".series-description").first().text().trim();
  const cover = $(".series-header-thumbnail img").first().attr("src") || "";
  const genres = []; // El sitio no publica generos/tags en la ficha de la obra.

  let chapters = parseChapterArticles($);

  const loadMoreBtn = $("#load-more-series").first();
  const categoryId = loadMoreBtn.attr("data-category") || $(".chapters-list").first().attr("data-category") || "";
  const totalPosts = Number(loadMoreBtn.attr("data-total")) || 0;

  // La pagina estatica solo trae los primeros 10 posts (contando los
  // duplicados EN/ES); si la obra tiene mas, el resto se pagina via el mismo
  // AJAX que usa el boton "Load More Chapters" del sitio.
  if (categoryId && loadMoreBtn.length && totalPosts > CHAPTER_PAGE_SIZE) {
    const nonce = extractNonce(html) || (await ensureNonce());
    if (nonce) {
      const totalPages = Math.min(Math.ceil(totalPosts / CHAPTER_PAGE_SIZE), MAX_CHAPTER_AJAX_PAGES);
      const pagesToFetch = [];
      for (let p = 2; p <= totalPages; p += 1) pagesToFetch.push(p);

      // Se piden en tandas concurrentes: series largas (Berserk, Bleach, etc.)
      // llegan a 70+ paginas y pedirlas una por una tardaria decenas de
      // segundos. Aun asi MAX_CHAPTER_AJAX_PAGES limita el peor caso para no
      // machacar el sitio ni colgar la respuesta -- en obras muy largas esto
      // puede dejar afuera los capitulos mas antiguos (se prioriza traer los
      // mas nuevos, que es el orden por defecto del sitio).
      for (let i = 0; i < pagesToFetch.length; i += CHAPTER_FETCH_CONCURRENCY) {
        const batch = pagesToFetch.slice(i, i + CHAPTER_FETCH_CONCURRENCY);
        const results = await Promise.all(
          batch.map((p) =>
            fetchAjax({
              action: "mangaverse_load_more",
              nonce,
              page: p,
              type: "series",
              category_id: categoryId,
              order: "desc",
              lang: "es",
            }).catch(() => null)
          )
        );
        for (const raw of results) {
          if (raw && raw.success && raw.data && raw.data.html) {
            const $frag = cheerio.load(raw.data.html);
            chapters = chapters.concat(parseChapterArticles($frag));
          }
        }
      }
    }
  }

  const seen = new Set();
  const uniqueChapters = [];
  for (const chapter of chapters) {
    if (seen.has(chapter.uploadId)) continue;
    seen.add(chapter.uploadId);
    uniqueChapters.push(chapter);
  }
  uniqueChapters.sort((a, b) => (a.number || 0) - (b.number || 0));

  return { id: slug, slug, title, year: null, synopsis, cover, genres, chapters: uniqueChapters, url, source: "infinitymanga" };
}

async function getChapterPages(uploadId) {
  const parsed = parseUploadId(uploadId);
  if (!parsed) {
    throw new ApiError(400, "uploadId invalido");
  }

  const cleanPath = `${parsed.mangaSlug}/${parsed.chapterSlug}`;
  const url = `${BASE_URL}/es/${cleanPath}.html`;
  const html = await fetchHtml(url);

  if (!matchesCanonical(html, `/es/${cleanPath}.html`)) {
    throw new ApiError(404, "No se encontraron paginas para este capitulo");
  }

  const $ = cheerio.load(html);

  // Las imagenes se cargan con lazyload: el atributo "src" solo trae un gif
  // placeholder en base64 y la URL real esta en "data-src" (CDN propio,
  // cdn.infinitymanga.com), a veces con espacios/saltos de linea alrededor
  // por como el theme arma el HTML -- por eso el trim().
  const pages = [];
  $("img[data-src]").each((_, el) => {
    const raw = $(el).attr("data-src");
    const src = raw ? raw.trim() : "";
    if (src && !src.startsWith("data:") && !pages.includes(src)) {
      pages.push(new URL(src, BASE_URL).href);
    }
  });

  if (pages.length === 0) {
    throw new ApiError(404, "No se encontraron paginas para este capitulo");
  }

  const title = $(".entry-title").first().text().trim() || $("title").text().trim();

  return { uploadId: cleanPath, pages, title };
}

module.exports = {
  searchContent,
  getCatalog,
  getMangaInfo,
  getChapterPages,
};
