const axios = require("axios");
const cheerio = require("cheerio");
const { ApiError } = require("../../utils/api-error");

const HTML_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
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

function getAbsoluteUrl(base, path) {
  if (!path) return "";
  try {
    return new URL(path, base).href;
  } catch (_error) {
    return path;
  }
}

// Motor compartido por ZonaTMO y TMOHentai (mismo desarrollador, pero usan dos
// plantillas HTML distintas: la "clasica" (ZonaTMO) y la "md-*" mas nueva
// (TMOHentai). Cada funcion intenta la plantilla clasica primero y cae a la
// plantilla "md-*" si no encuentra nada, para no duplicar todo el servicio.
function createTmoService(baseUrl, librarySegment) {
  const source = librarySegment === "hentai" ? "tmohentai" : "zonatmo";

  function parseClassicCards($) {
    const items = [];
    $(".element[data-identifier]").each((_, el) => {
      const element = $(el);
      const id = element.attr("data-identifier");
      const href = element.find("a").first().attr("href") || "";
      const title = element.find("h4").first().text().trim();
      const cover = getAbsoluteUrl(
        baseUrl,
        element.find("img.cover-bg-img").attr("src") || element.find("[data-bg]").attr("data-bg")
      );
      const rating = element.find(".score span").first().text().trim() || null;
      const type = element.find(".book-type").first().text().trim() || null;
      const slugMatch = href.match(/\/library\/[a-z]+\/\d+\/([^/?#]+)/i);
      const slug = slugMatch ? slugMatch[1] : "";

      if (id && title) {
        items.push({ id, slug, title, cover, rating, type, url: href, source });
      }
    });
    return items;
  }

  function parseModernCards($) {
    const items = [];
    $("a.manga-card").each((_, el) => {
      const a = $(el);
      const href = a.attr("href") || "";
      const title = a.attr("title") || a.find(".manga-card__title").first().text().trim();
      const cover = getAbsoluteUrl(baseUrl, a.find("img").first().attr("src"));
      const idMatch = href.match(/\/library\/[a-z]+\/(\d+)\//i);
      const slugMatch = href.match(/\/library\/[a-z]+\/\d+\/([^/?#]+)/i);
      const id = idMatch ? idMatch[1] : null;
      const slug = slugMatch ? slugMatch[1] : "";

      if (id && title) {
        items.push({ id, slug, title, cover, rating: null, type: null, url: href, source });
      }
    });
    return items;
  }

  function parseLibraryResults(html) {
    const $ = cheerio.load(html);
    const classic = parseClassicCards($);
    return classic.length > 0 ? classic : parseModernCards($);
  }

  async function searchContent(query) {
    if (!query) {
      throw new ApiError(400, "El parametro de busqueda 'q' es requerido");
    }
    const url = `${baseUrl}/biblioteca?title=${encodeURIComponent(query)}`;
    const html = await fetchHtml(url);
    return parseLibraryResults(html);
  }

  // options.tagIds: IDs numericos de genero (ver /biblioteca -> checkboxes
  // "tags[]"). options.sort: 'az' | 'za' para orden alfabetico; cualquier
  // otro valor (o ninguno) deja el orden por defecto del sitio (populares).
  // Verificado en vivo contra tmohentai.app: filtrar por tags[] SI cambia el
  // set de resultados (probado con Ahegao: 4563 -> 1788, distinto primer
  // resultado), y usa la misma plantilla "moderna" que ya parsea parseModernCards.
  async function getCatalog(page = 1, options = {}) {
    const { tagIds = [], sort = null } = options;
    const params = new URLSearchParams();
    params.set("page", String(Number(page) || 1));
    for (const id of tagIds) {
      const numId = Number(id);
      if (Number.isFinite(numId)) params.append("tags[]", String(numId));
    }
    if (sort === "az") {
      params.set("order_item", "alphabetically");
      params.set("order_dir", "asc");
    } else if (sort === "za") {
      params.set("order_item", "alphabetically");
      params.set("order_dir", "desc");
    }
    const url = `${baseUrl}/biblioteca?${params.toString()}`;
    const html = await fetchHtml(url);
    return parseLibraryResults(html);
  }

  function parseClassicInfo($, id, slug, url) {
    const titleEl = $("h1.element-title").first();
    if (titleEl.length === 0) return null;

    const year = titleEl.find("small").text().trim().replace(/[()]/g, "") || null;
    titleEl.find("small").remove();
    const title = titleEl.text().trim();
    if (!title) return null;

    const synopsis = $("#manga-synopsis").text().trim();
    const cover = getAbsoluteUrl(
      baseUrl,
      $("img.book-thumbnail").first().attr("src") || $('meta[property="og:image"]').attr("content")
    );

    const genres = [];
    $("a.badge.badge-primary").each((_, el) => {
      const name = $(el).text().trim();
      if (name && !genres.includes(name)) genres.push(name);
    });

    const chapters = [];
    $("li.upload-link").each((_, el) => {
      const li = $(el);
      const chapterNumber = Number(li.attr("data-chapter-number"));
      const readHref =
        li.find('a.btn-primary[href*="view_uploads"]').attr("href") ||
        li.find('a[href*="view_uploads"]').first().attr("href");
      if (!readHref) return;
      const uploadIdMatch = readHref.match(/view_uploads\/(\d+)/);
      if (!uploadIdMatch) return;

      chapters.push({
        number: Number.isFinite(chapterNumber) ? chapterNumber : null,
        uploadId: uploadIdMatch[1],
        title: Number.isFinite(chapterNumber) ? `Capítulo ${chapterNumber}` : "Capítulo",
      });
    });
    chapters.sort((a, b) => (a.number || 0) - (b.number || 0));

    return { id, slug, title, year, synopsis, cover, genres, chapters, url, source };
  }

  function parseModernInfo($, id, slug, url) {
    const title = $("h1#md-title").first().text().trim();
    if (!title) return null;

    const synopsis = $(".md-info-row--synopsis .md-info-row__value").first().text().trim();
    const cover = getAbsoluteUrl(baseUrl, $('meta[property="og:image"]').attr("content"));

    const genres = [];
    $("#md-tags-list a span.label").each((_, el) => {
      const name = $(el).text().trim();
      if (name && !genres.includes(name)) genres.push(name);
    });

    // Los trabajos de este tipo de plantilla suelen ser one-shots: un solo
    // "capitulo" que es la propia obra (view_uploads/{id}).
    const readHref = $('a.md-preview-read-btn[href*="view_uploads"]').attr("href");
    const uploadIdMatch = readHref ? readHref.match(/view_uploads\/(\d+)/) : null;
    const chapters = uploadIdMatch ? [{ number: 1, uploadId: uploadIdMatch[1], title: "Leer" }] : [];

    return { id, slug, title, year: null, synopsis, cover, genres, chapters, url, source };
  }

  // mangaPath tiene la forma "{id}/{slug}" (asi lo pasa la ruta /manga/:source/*)
  async function getMangaInfo(mangaPath) {
    const [id, slug] = String(mangaPath || "").split("/").filter(Boolean);
    if (!id || !slug) {
      throw new ApiError(400, "Se requiere el path 'id/slug' del manga");
    }
    const url = `${baseUrl}/library/${librarySegment}/${id}/${slug}`;
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    const info = parseClassicInfo($, id, slug, url) || parseModernInfo($, id, slug, url);
    if (!info) {
      throw new ApiError(404, "Manga no encontrado");
    }
    return info;
  }

  async function getChapterPages(uploadId) {
    if (!uploadId) {
      throw new ApiError(400, "uploadId es requerido");
    }
    const url = `${baseUrl}/view_uploads/${uploadId}`;
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    // Selector comun a ambas plantillas: el contenedor de cada pagina siempre
    // es .reader-img-wrap, aunque el <img> interno no siempre tenga clase.
    // TMOHentai ademas usa lazy-loading nativo en la plantilla moderna: solo
    // las primeras paginas traen "src", el resto solo trae "data-src" hasta
    // que el JS del lector las carga en el navegador real, asi que hay que
    // leer ambos atributos.
    const pages = [];
    $(".reader-img-wrap, .reader-image").each((_, wrap) => {
      const img = $(wrap).is("img") ? $(wrap) : $(wrap).find("img").first();
      const src = img.attr("src") || img.attr("data-src");
      if (src && !pages.includes(src)) pages.push(getAbsoluteUrl(baseUrl, src));
    });

    if (pages.length === 0) {
      throw new ApiError(404, "No se encontraron paginas para este capitulo");
    }

    return { uploadId, pages, title: $("title").text().trim() };
  }

  return { searchContent, getCatalog, getMangaInfo, getChapterPages };
}

module.exports = {
  tmohentai: createTmoService("https://tmohentai.app", "hentai"),
};
