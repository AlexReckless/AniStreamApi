const axios = require("axios");
const cheerio = require("cheerio");
const { ApiError } = require("../../utils/api-error");

const BASE_URL = "https://olympusxyz.com";

const HTML_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
};

// Reemplazo de ZonaTMO (bloqueaba la IP de Render con 403). Olympus Scanlation
// es HTML estatico sin proteccion anti-bot, scrapeable directo con cheerio.
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
    throw new ApiError(500, "No se pudo obtener contenido de Olympus Scanlation", error.message);
  }
}

function slugFromPath(mangaPath) {
  const parts = String(mangaPath || "")
    .split("/")
    .filter(Boolean);
  return parts[parts.length - 1] || "";
}

// OJO: el sitio tiene una API JSON propia (/api/series?type=comic&page=N) que
// parecia mas prolija, pero su campo "slug" es inestable -- pide el mismo
// registro dos veces y devuelve un slug distinto cada vez, que ademas no
// coincide con la URL real de la pagina (404 constante). Por eso se volvio a
// parsear el HTML estatico de /series directo: los href que trae esa pagina
// SI son estables y apuntan a la pagina real de cada obra.
function parseCatalogCards($) {
  const items = [];
  $('a[href^="/series/"]').each((_, el) => {
    const a = $(el);
    const href = a.attr("href") || "";
    const slug = href.replace(/^\/series\//, "").replace(/\/$/, "");
    const title = a.find("figcaption").first().text().trim() || a.find("img").first().attr("alt") || "";
    const cover = a.find("img").first().attr("src") || "";

    if (slug && title && !items.some((i) => i.slug === slug)) {
      items.push({ id: slug, slug, title, cover, rating: null, type: null, url: `${BASE_URL}${href}`, source: "olympus" });
    }
  });
  return items;
}

// El sitio no pagina por query string (?page= da 404) y no tiene busqueda
// server-side real -- solo la pagina 1 de /series viene en el HTML estatico.
async function getCatalog(page = 1) {
  const pageNum = Number(page) || 1;
  if (pageNum > 1) return { items: [], hasNextPage: false };

  const html = await fetchHtml(`${BASE_URL}/series`);
  const $ = cheerio.load(html);
  return { items: parseCatalogCards($), hasNextPage: false };
}

async function searchContent(query) {
  if (!query) {
    throw new ApiError(400, "El parametro de busqueda 'q' es requerido");
  }
  const normalized = query.toLowerCase();
  const { items } = await getCatalog(1);
  return items.filter((item) => item.title.toLowerCase().includes(normalized));
}

async function getMangaInfo(mangaPath) {
  const slug = slugFromPath(mangaPath);
  if (!slug) {
    throw new ApiError(400, "Se requiere el slug de la obra");
  }

  const url = `${BASE_URL}/series/${slug}`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const title = $("h1").first().text().trim();
  if (!title) {
    throw new ApiError(404, "Obra no encontrada");
  }

  const synopsis = $('meta[name="description"]').attr("content") || "";
  const cover = $('meta[property="og:image"]').attr("content") || "";

  const genres = [];
  $('a[href*="/generos/"], a[href*="/genero/"]').each((_, el) => {
    const name = $(el).text().trim();
    if (name && !genres.includes(name)) genres.push(name);
  });

  const chapters = [];
  $('a[href*="/capitulo/"]').each((_, el) => {
    const href = $(el).attr("href") || "";
    const match = href.match(/\/capitulo\/(\d+)\/([^/?#]+)/);
    if (!match) return;
    const uploadId = `${match[1]}/${match[2]}`;
    if (chapters.some((c) => c.uploadId === uploadId)) return;
    const label = $(el).text().trim();
    const numMatch = label.match(/(\d+(?:\.\d+)?)/);
    chapters.push({
      number: numMatch ? Number(numMatch[1]) : null,
      uploadId,
      title: label || "Capítulo",
    });
  });
  chapters.sort((a, b) => (a.number || 0) - (b.number || 0));

  return { id: slug, slug, title, year: null, synopsis, cover, genres, chapters, url, source: "olympus" };
}

async function getChapterPages(uploadId) {
  const cleanPath = String(uploadId || "").replace(/^\/+/, "");
  if (!cleanPath.includes("/")) {
    throw new ApiError(400, "uploadId invalido");
  }

  const url = `${BASE_URL}/capitulo/${cleanPath}`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  // El sitio uso al menos 2 convenciones de CDN distintas para las imagenes
  // segun cuando se subio el capitulo (/cp/cp-N.jpg viejas, imagesolymp.xyz
  // nuevas); el alt="... > Page NN" si es consistente en ambas, es la señal
  // mas confiable para identificar solo las paginas reales (no logo/iconos).
  const pages = [];
  $("img").each((_, el) => {
    const img = $(el);
    const alt = img.attr("alt") || "";
    const src = img.attr("src");
    if (src && /page\s*\d+/i.test(alt) && !pages.includes(src)) {
      pages.push(new URL(src, BASE_URL).href);
    }
  });

  if (pages.length === 0) {
    throw new ApiError(404, "No se encontraron paginas para este capitulo");
  }

  return { uploadId: cleanPath, pages, title: $("title").text().trim() };
}

module.exports = {
  searchContent,
  getCatalog,
  getMangaInfo,
  getChapterPages,
};
