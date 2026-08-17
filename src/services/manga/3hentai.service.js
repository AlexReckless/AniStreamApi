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

function getAbsoluteUrl(base, path) {
  if (!path) return "";
  try {
    return new URL(path, base).href;
  } catch (_error) {
    return path;
  }
}

// Servicio adaptado para 3hentai.net
function createThreeHentaiService() {
  const baseUrl = "https://es.3hentai.net";
  const source = "3hentai";

  // Función principal para parsear resultados de búsqueda/catálogo
  function parseSearchResults(html) {
    const $ = cheerio.load(html);
    const items = [];

    // Selectores comunes en sitios de mangas similares
    $(".gallery, .element, .thumb, .manga-card").each((_, el) => {
      const element = $(el);
      
      // Intentar obtener ID del elemento
      const id = element.attr("data-id") || 
                 element.attr("data-identifier") || 
                 element.find("a").attr("href")?.match(/\/(\d+)\//)?.[1];
      
      // Obtener enlace
      const href = element.find("a").first().attr("href") || "";
      
      // Obtener título
      const title = element.find(".title, h4, .manga-card__title").first().text().trim() || 
                    element.find("a").first().attr("title") || 
                    element.find("img").attr("alt");
      
      // Obtener portada
      const cover = getAbsoluteUrl(
        baseUrl,
        element.find("img").first().attr("src") || 
        element.find("img").first().attr("data-src") || 
        element.find("[data-bg]").attr("data-bg")
      );
      
      // Obtener calificación si existe
      const rating = element.find(".score, .rating").first().text().trim() || null;
      
      // Obtener tipo si existe
      const type = element.find(".type, .book-type, .badge").first().text().trim() || null;

      if (id && title) {
        items.push({
          id: String(id),
          slug: href.split("/").filter(Boolean).pop() || "",
          title,
          cover,
          rating,
          type,
          url: getAbsoluteUrl(baseUrl, href),
          source
        });
      }
    });

    return items;
  }

  // Búsqueda de contenido
  async function searchContent(query) {
    if (!query) {
      throw new ApiError(400, "El parámetro de búsqueda 'q' es requerido");
    }
    const url = `${baseUrl}/search?q=${encodeURIComponent(query)}`;
    const html = await fetchHtml(url);
    return parseSearchResults(html);
  }

  // Obtener catálogo con filtros
  async function getCatalog(page = 1, options = {}) {
    const { tags = [], sort = null, type = null } = options;
    const params = new URLSearchParams();
    params.set("page", String(Number(page) || 1));
    
    // Agregar filtros de etiquetas
    if (tags && tags.length > 0) {
      tags.forEach(tag => params.append("tags", tag));
    }
    
    // Ordenamiento
    if (sort === "az") {
      params.set("sort", "title_asc");
    } else if (sort === "za") {
      params.set("sort", "title_desc");
    } else if (sort === "popular") {
      params.set("sort", "popular");
    } else if (sort === "latest") {
      params.set("sort", "latest");
    }
    
    // Tipo de contenido
    if (type) {
      params.set("type", type);
    }

    const url = `${baseUrl}/catalog?${params.toString()}`;
    const html = await fetchHtml(url);
    return parseSearchResults(html);
  }

  // Obtener información detallada de un manga
  async function getMangaInfo(mangaPath) {
    // El dispatcher generico (manga.routes.js "/manga/:source/*") manda el
    // wildcard completo "{id}/{slug}" (mismo formato que arma el front en
    // MangaScreen.jsx: `${item.id}/${item.slug}`) -- solo el id es parte real
    // de la URL del sitio (.../g/{id}/), asi que hay que separarlo primero
    // (mismo patron que ya usa mangaoni.service.js con su propio mangaPath).
    const [mangaId] = String(mangaPath || "").split("/").filter(Boolean);
    if (!mangaId) {
      throw new ApiError(400, "Se requiere el ID del manga");
    }

    const url = `${baseUrl}/g/${mangaId}`;
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    // Intentar obtener título
    const title = $("h1.title, .title, .entry-title").first().text().trim();
    if (!title) {
      throw new ApiError(404, "Manga no encontrado");
    }

    // Obtener sinopsis
    const synopsis = $(".description, .synopsis, .summary").first().text().trim();
    
    // Obtener portada
    const cover = getAbsoluteUrl(
      baseUrl,
      $("img.cover, .thumbnail img, .cover-image").first().attr("src") || 
      $('meta[property="og:image"]').attr("content")
    );

    // Obtener géneros/etiquetas
    const genres = [];
    $(".tags a, .genres a, .labels a").each((_, el) => {
      const name = $(el).text().trim();
      if (name && !genres.includes(name)) genres.push(name);
    });

    // Obtener capítulos
    const chapters = [];
    $(".chapter-list li, .chapters-list a, .upload-link").each((_, el) => {
      const element = $(el);
      const chapterHref = element.attr("href") || element.find("a").attr("href") || "";
      const chapterTitle = element.text().trim() || "Capítulo";
      const chapterMatch = chapterHref.match(/(\d+)/);
      
      if (chapterHref) {
        chapters.push({
          number: chapters.length + 1,
          uploadId: chapterMatch ? chapterMatch[1] : String(chapters.length + 1),
          title: chapterTitle,
          url: getAbsoluteUrl(baseUrl, chapterHref)
        });
      }
    });

    // Si no hay capítulos detectados, intentar con el formato de lectura directa
    if (chapters.length === 0) {
      const readUrl = $("a.read-btn, .read-link, a:contains('Leer')").attr("href");
      if (readUrl) {
        const uploadId = readUrl.match(/(\d+)/)?.[1] || mangaId;
        chapters.push({
          number: 1,
          uploadId: uploadId,
          title: "Leer",
          url: getAbsoluteUrl(baseUrl, readUrl)
        });
      }
    }

    // Obtener metadatos adicionales
    const author = $(".author, .artist").first().text().trim() || null;
    const year = $(".year, .date").first().text().trim() || null;
    const pages = $(".pages, .page-count").first().text().trim() || null;

    return {
      id: String(mangaId),
      slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      title,
      author,
      year,
      pages,
      synopsis,
      cover,
      genres,
      chapters,
      url,
      source
    };
  }

  // Obtener páginas de un capítulo
  async function getChapterPages(uploadId) {
    if (!uploadId) {
      throw new ApiError(400, "uploadId es requerido");
    }
    
    const url = `${baseUrl}/view_uploads/${uploadId}`;
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    const pages = [];
    
    // Selectores comunes para páginas de lectura
    $(".reader-img-wrap img, .reader-image img, .page-image img").each((_, img) => {
      const src = $(img).attr("src") || $(img).attr("data-src");
      if (src) {
        const absoluteUrl = getAbsoluteUrl(baseUrl, src);
        if (!pages.includes(absoluteUrl)) {
          pages.push(absoluteUrl);
        }
      }
    });

    // Si no se encontraron páginas con los selectores anteriores
    if (pages.length === 0) {
      // Intentar con otros selectores comunes
      $("img[src*='uploads'], img[data-src*='uploads']").each((_, img) => {
        const src = $(img).attr("src") || $(img).attr("data-src");
        if (src) {
          const absoluteUrl = getAbsoluteUrl(baseUrl, src);
          if (!pages.includes(absoluteUrl)) {
            pages.push(absoluteUrl);
          }
        }
      });
    }

    if (pages.length === 0) {
      throw new ApiError(404, "No se encontraron páginas para este capítulo");
    }

    return {
      uploadId,
      pages,
      totalPages: pages.length,
      title: $("title").text().trim() || `Capítulo ${uploadId}`
    };
  }

  // Función para obtener tags/géneros disponibles
  async function getAvailableTags() {
    const url = `${baseUrl}/tags`;
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    
    const tags = [];
    $(".tag-item, .genre-item, .label-item").each((_, el) => {
      const element = $(el);
      const name = element.text().trim();
      const href = element.find("a").attr("href") || "";
      const id = href.match(/(\d+)/)?.[1] || null;
      
      if (name) {
        tags.push({
          id: id || name.toLowerCase().replace(/\s+/g, "-"),
          name: name,
          url: getAbsoluteUrl(baseUrl, href)
        });
      }
    });
    
    return tags;
  }

  return { 
    searchContent, 
    getCatalog, 
    getMangaInfo, 
    getChapterPages,
    getAvailableTags,
    baseUrl,
    source 
  };
}

// Exportar el servicio (mismo formato plano que el resto de src/services/manga/*)
module.exports = createThreeHentaiService();