const axios = require("axios");
const cheerio = require("cheerio");
const { ApiError } = require("../../utils/api-error");

const BASE_URL = "https://kingcomix.com";

const HTML_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
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
    throw new ApiError(500, "No se pudo obtener contenido de KingComix", error.message);
  }
}

// KingComiX es WordPress: cada "comic" es un post normal sin capitulos, asi que
// se maneja igual que Simply-Hentai (one-shot: un solo "capitulo" = el post entero).
// El path que viaja entre front/back es simplemente el slug del post; si llega con
// segmentos extra (ej. "id/slug" armado por el front) solo se usa el ultimo.
function slugFromPath(mangaPath) {
  const parts = String(mangaPath || "")
    .split("/")
    .filter(Boolean);
  return parts[parts.length - 1] || "";
}

function slugFromHref(href) {
  try {
    const { pathname } = new URL(href, BASE_URL);
    return pathname.replace(/^\/+|\/+$/g, "");
  } catch (_error) {
    return "";
  }
}

function parseCatalogCards($) {
  const items = [];
  $(".blog-list-items .entry, .content .entry").each((_, el) => {
    const entry = $(el);
    const href = entry.find("a").first().attr("href") || "";
    const slug = slugFromHref(href);
    const title = entry.find("h2.information a").first().text().trim();
    const cover = entry.find("img").first().attr("src") || "";

    if (slug && title) {
      items.push({ id: slug, slug, title, cover, rating: null, type: null, url: href, source: "kingcomix" });
    }
  });
  return items;
}

function parseSearchCards($) {
  const items = [];
  $("article.thumb-block").each((_, el) => {
    const article = $(el);
    const href = article.find("a").first().attr("href") || "";
    const slug = slugFromHref(href);
    const title = article.find(".cat-title").first().text().trim() || article.find("a").first().attr("title") || "";
    const cover = article.find("img").first().attr("src") || "";

    if (slug && title) {
      items.push({ id: slug, slug, title, cover, rating: null, type: null, url: href, source: "kingcomix" });
    }
  });
  return items;
}

function hasNextPageLink($) {
  let found = false;
  $(".pagination a").each((_, el) => {
    if ($(el).text().trim().toLowerCase() === "next") found = true;
  });
  return found;
}

async function searchContent(query) {
  if (!query) {
    throw new ApiError(400, "El parametro de busqueda 'q' es requerido");
  }
  const url = `${BASE_URL}/?s=${encodeURIComponent(query)}`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  return parseSearchCards($);
}

async function getCatalog(page = 1) {
  const pageNum = Number(page) || 1;
  const url = pageNum <= 1 ? `${BASE_URL}/` : `${BASE_URL}/page/${pageNum}/`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const items = parseCatalogCards($);
  return { items, hasNextPage: hasNextPageLink($) };
}

async function getMangaInfo(mangaPath) {
  const slug = slugFromPath(mangaPath);
  if (!slug) {
    throw new ApiError(400, "Se requiere el slug del comic");
  }

  const url = `${BASE_URL}/${slug}/`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const title = $("h1.singleTitle-h1").first().text().trim();
  if (!title) {
    throw new ApiError(404, "Comic no encontrado");
  }

  const synopsis = $('meta[property="og:description"]').attr("content") || "";
  const cover = $('meta[property="og:image"]').attr("content") || "";

  const genres = [];
  $("#breadcrumbs a").each((_, el) => {
    const name = $(el).text().trim();
    if (name && name !== "KingComiX" && !genres.includes(name)) genres.push(name);
  });

  // Un comic de KingComix es un unico post con todas las paginas en galeria:
  // se modela como "capitulo unico" igual que Simply-Hentai.
  const pageCount = $(".entry-content img[class*=wp-image]").length;
  const chapters = pageCount > 0 ? [{ number: 1, uploadId: slug, title: "Leer" }] : [];

  return { id: slug, slug, title, year: null, synopsis, cover, genres, chapters, url, source: "kingcomix" };
}

async function getChapterPages(uploadId) {
  const slug = slugFromPath(uploadId);
  if (!slug) {
    throw new ApiError(400, "uploadId invalido");
  }

  const url = `${BASE_URL}/${slug}/`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const pages = [];
  $(".entry-content img[class*=wp-image]").each((_, el) => {
    const src = $(el).attr("src");
    if (src && !pages.includes(src)) pages.push(src);
  });

  if (pages.length === 0) {
    throw new ApiError(404, "No se encontraron paginas para este comic");
  }

  return { uploadId: slug, pages, title: $("h1.singleTitle-h1").first().text().trim() };
}

module.exports = {
  searchContent,
  getCatalog,
  getMangaInfo,
  getChapterPages,
};
