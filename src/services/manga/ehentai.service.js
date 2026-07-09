const axios = require("axios");
const cheerio = require("cheerio");
const { ApiError } = require("../../utils/api-error");

const BASE_URL = "https://e-hentai.org";

const HTML_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
};

// Reemplazo de KingComix (bloqueaba la IP de Render con 403). E-Hentai es HTML
// estatico sin proteccion anti-bot ni challenge de Cloudflare, con busqueda real.
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
    throw new ApiError(500, "No se pudo obtener contenido de E-Hentai", error.message);
  }
}

function slugFromPath(mangaPath) {
  // El "path" para esta fuente es directamente "{id}/{token}" del gallery.
  const parts = String(mangaPath || "")
    .split("/")
    .filter(Boolean);
  return parts.slice(-2).join("/");
}

function parseCatalogCards($) {
  const items = [];
  // La vista lista (.itg > tr, la que usa /?...) separa imagen y nombre en
  // celdas <td> distintas de la misma fila; hay que operar sobre la fila
  // completa (tr), no sobre la celda del nombre sola.
  $(".itg tr, .gl1t").each((_, el) => {
    const row = $(el).is("tr") ? $(el) : $(el).closest("tr");
    const scope = row.length ? row : $(el);
    const a = scope.find('a[href*="/g/"]').first();
    const href = a.attr("href") || "";
    const match = href.match(/\/g\/(\d+)\/([a-z0-9]+)/i);
    if (!match) return;

    const id = match[1];
    const token = match[2];
    const title = scope.find(".glink").first().text().trim() || a.attr("title") || "";
    const img = scope.find("img").first();
    const cover = img.attr("src") || img.attr("data-src") || "";

    if (title && !items.some((i) => i.id === id)) {
      items.push({ id, slug: token, title, cover, rating: null, type: null, url: href, source: "ehentai" });
    }
  });
  return items;
}

async function getCatalog(page = 1) {
  const pageNum = Number(page) || 1;
  const url = `${BASE_URL}/?page=${pageNum - 1}`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const items = parseCatalogCards($);
  const hasNextPage = $('a[onclick*="return false"]').text().includes(">") || items.length >= 20;
  return { items, hasNextPage };
}

async function searchContent(query) {
  if (!query) {
    throw new ApiError(400, "El parametro de busqueda 'q' es requerido");
  }
  const url = `${BASE_URL}/?f_search=${encodeURIComponent(query)}`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  return parseCatalogCards($);
}

async function getMangaInfo(mangaPath) {
  const idToken = slugFromPath(mangaPath);
  if (!idToken.includes("/")) {
    throw new ApiError(400, "Se requiere el path 'id/token' de la galeria");
  }

  const url = `${BASE_URL}/g/${idToken}/`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const title = $("#gn").first().text().trim() || $("title").text().trim();
  if (!title) {
    throw new ApiError(404, "Galeria no encontrada");
  }

  const synopsis = "";
  const cover = $("#gd1 img").first().attr("src") || "";

  const genres = [];
  $('#taglist a[id^="ta_"]').each((_, el) => {
    const name = $(el).text().trim();
    if (name && !genres.includes(name)) genres.push(name);
  });

  const pageCount = $("#gdt a").length;
  const chapters = pageCount > 0 ? [{ number: 1, uploadId: idToken, title: "Leer" }] : [];

  const [id, slug] = idToken.split("/");
  return { id, slug, title, year: null, synopsis, cover, genres, chapters, url, source: "ehentai" };
}

async function getChapterPages(uploadId) {
  const idToken = slugFromPath(uploadId);
  if (!idToken.includes("/")) {
    throw new ApiError(400, "uploadId invalido");
  }

  const detailUrl = `${BASE_URL}/g/${idToken}/`;
  const detailHtml = await fetchHtml(detailUrl);
  const $detail = cheerio.load(detailHtml);

  // #gdt trae el link a la pagina individual de cada imagen (/s/{key}/{id}-{n});
  // hay que visitar cada una para sacar la URL real de la imagen en #img.
  const pageLinks = [];
  $detail("#gdt a").each((_, el) => {
    const href = $detail(el).attr("href");
    if (href) pageLinks.push(href);
  });

  if (pageLinks.length === 0) {
    throw new ApiError(404, "No se encontraron paginas para esta galeria");
  }

  const pages = [];
  for (const link of pageLinks) {
    try {
      const html = await fetchHtml(link);
      const $page = cheerio.load(html);
      const src = $page("#img").attr("src");
      if (src) pages.push(src);
    } catch (_error) {
      // saltar paginas individuales que fallen, no abortar la galeria completa
    }
  }

  if (pages.length === 0) {
    throw new ApiError(404, "No se pudieron cargar las paginas de esta galeria");
  }

  return { uploadId: idToken, pages, title: $detail("#gn").first().text().trim() };
}

module.exports = {
  searchContent,
  getCatalog,
  getMangaInfo,
  getChapterPages,
};
