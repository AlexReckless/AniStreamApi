const axios = require("axios");
const cheerio = require("cheerio");
const { ApiError } = require("../../utils/api-error");

const HTML_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
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
    throw new ApiError(500, "No se pudo obtener contenido del sitio de manga", error.message);
  }
}

// Servicio para es.3hentai.net -- estructura verificada en vivo (curl real
// contra el sitio, no adivinada) el 2026-08-16:
//   - Listado (home "/", pagina N "/N", busqueda "/search?q=..."):
//     cada carta es <div class="doujin"><a class="cover" href=".../d/{id}">
//       <img class="lazy" data-src="{cover}"><div class="title ...">{titulo}</div>
//     </a></div>
//   - Detalle "/d/{id}": <h1>{titulo}</h1>, portada en
//     #main-cover img[data-src]="https://s1.3hentai.net/{imgFolder}/cover.jpg",
//     metadatos en <div class="tag-container field-name">Label: ...</div>
//     (Idiomas/Categorias/Paginas/Añadido; Categorias+Tags+Artistas si
//     existen se usan como generos).
//   - NO tiene capitulos: cada "manga" es una sola galeria/doujin de N
//     paginas. La pagina N se sirve como imagen directa en
//     "https://s1.3hentai.net/{imgFolder}/{N}.{ext}" -- mismo folder y
//     extension que la portada -- asi que con el conteo de "Paginas" del
//     detalle alcanza para armar todas las URLs sin pedir cada pagina.
function createThreeHentaiService() {
  const baseUrl = "https://es.3hentai.net";
  const source = "3hentai";

  function buildCatalogUrl(page = 1) {
    const p = Number(page) || 1;
    return p <= 1 ? `${baseUrl}/` : `${baseUrl}/${p}`;
  }

  function buildSearchUrl(query) {
    if (!query) {
      throw new ApiError(400, "El parámetro de búsqueda 'q' es requerido");
    }
    return `${baseUrl}/search?q=${encodeURIComponent(query)}`;
  }

  function parseCatalogHtml(html) {
    const $ = cheerio.load(html);
    const items = [];
    const seen = new Set();

    $(".doujin a.cover").each((_, el) => {
      const href = $(el).attr("href") || "";
      const idMatch = href.match(/\/d\/(\d+)/);
      if (!idMatch) return;
      const id = idMatch[1];
      if (seen.has(id)) return;
      seen.add(id);

      const title = $(el).find(".title").first().text().trim();
      if (!title) return;
      const img = $(el).find("img").first();
      const cover = img.attr("data-src") || img.attr("src") || null;

      items.push({ id, slug: "", title, cover, rating: null, type: null, url: href, source });
    });

    // El sitio no marca un rel="next" -- con que la pagina haya traido
    // resultados alcanza (el catalogo real tiene miles de paginas).
    return { items, hasNextPage: items.length > 0 };
  }

  async function searchContent(query) {
    const html = await fetchHtml(buildSearchUrl(query));
    return parseCatalogHtml(html).items;
  }

  async function getCatalog(page = 1) {
    const html = await fetchHtml(buildCatalogUrl(page));
    return parseCatalogHtml(html);
  }

  // mangaPath llega como "{id}/{slug}" desde el dispatcher generico
  // (manga.routes.js "/manga/:source/*") -- solo el id es real aca, el resto
  // de las fuentes con slug propio (mangaoni) lo separan de la misma forma.
  async function getMangaInfo(mangaPath) {
    const [mangaId] = String(mangaPath || "").split("/").filter(Boolean);
    if (!mangaId) {
      throw new ApiError(400, "Se requiere el ID del manga");
    }

    const url = `${baseUrl}/d/${mangaId}`;
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    const title = $("h1").first().text().trim();
    if (!title) {
      throw new ApiError(404, "Manga no encontrado en 3Hentai");
    }

    const coverImg = $("#main-cover img").first();
    const cover = (coverImg.attr("data-src") || coverImg.attr("src") || "").trim() || null;

    const totalPages = parseInt(
      $('.tag-container.field-name:contains("Páginas")').first().find(".field-light-text").first().text().trim(),
      10
    ) || 0;

    // Generos/tags: cualquier bloque de metadatos salvo Idiomas/Paginas/Añadido.
    const genres = [];
    $(".tag-container.field-name").each((_, el) => {
      const label = $(el).clone().children().remove().end().text().trim();
      if (/^(Idiomas|P[aá]ginas|A[nñ]adido)/i.test(label)) return;
      $(el)
        .find(".filter-elem .name")
        .each((__, a) => {
          const name = $(a).text().trim();
          if (name && !genres.includes(name)) genres.push(name);
        });
    });

    return {
      id: mangaId,
      slug: "",
      title,
      synopsis: "",
      cover,
      genres,
      // Sin capitulos reales: una sola entrada que representa la galeria
      // completa (misma logica que usa getChapterPages de abajo).
      chapters: totalPages > 0 ? [{ number: 1, uploadId: mangaId, title: `Leer (${totalPages} páginas)` }] : [],
      url,
      source,
    };
  }

  async function getChapterPages(uploadId) {
    const [mangaId] = String(uploadId || "").split("/").filter(Boolean);
    if (!mangaId) {
      throw new ApiError(400, "uploadId es requerido");
    }

    const url = `${baseUrl}/d/${mangaId}`;
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    const title = $("h1").first().text().trim() || `Galería ${mangaId}`;

    const coverImg = $("#main-cover img").first();
    const coverSrc = (coverImg.attr("data-src") || coverImg.attr("src") || "").trim();
    const imgMatch = coverSrc.match(/^(https?:\/\/[^/]+\/[^/]+)\/(?:cover|thumb)\.(\w+)(?:\?.*)?$/i);

    const totalPages = parseInt(
      $('.tag-container.field-name:contains("Páginas")').first().find(".field-light-text").first().text().trim(),
      10
    ) || 0;

    if (!imgMatch || !totalPages) {
      throw new ApiError(404, "No se encontraron paginas para esta galeria");
    }

    const [, imgBase, ext] = imgMatch;
    const pages = Array.from({ length: totalPages }, (_, i) => `${imgBase}/${i + 1}.${ext}`);

    return { uploadId: mangaId, pages, title };
  }

  return {
    searchContent,
    getCatalog,
    getMangaInfo,
    getChapterPages,
    baseUrl,
    source,
  };
}

module.exports = createThreeHentaiService();
