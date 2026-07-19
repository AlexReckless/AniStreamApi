const axios = require("axios");
const { ApiError } = require("../../utils/api-error");

const BASE_URL = "https://www.simply-hentai.com";
const COLLECTION_PATH = "/collection/espanol-7722f";

// Ojo: este sitio bloquea (403) el User-Agent "completo" de Chrome con numero de
// version (el mismo que usamos en el resto de los scrapers); uno mas corto pasa sin problema.
const HTML_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
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
    throw new ApiError(500, "No se pudo obtener contenido de Simply Hentai", error.message);
  }
}

// Simply Hentai es una app Next.js: la pagina de coleccion/album viene con los
// datos ya armados en el <script id="__NEXT_DATA__">, mucho mas confiable que
// parsear el HTML renderizado (y trae imagenes en resolucion completa).
function extractNextData(html) {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (_error) {
    return null;
  }
}

function mapAlbumSummary(album) {
  const seriesSlug = album.series?.slug || null;
  return {
    id: String(album.id),
    slug: album.slug,
    title: album.title,
    cover: album.preview?.sizes?.full || album.preview?.sizes?.giant_thumb || album.preview?.sizes?.thumb || null,
    pages: album.image_count || null,
    type: album.series?.title || null,
    url: seriesSlug ? `${BASE_URL}/${seriesSlug}/${album.slug}` : null,
    // path que despues usan getMangaInfo/getChapterPages
    path: seriesSlug ? `${seriesSlug}/${album.slug}` : null,
    source: "simplyhentai",
  };
}

async function fetchCollectionPage(pageNum) {
  const url = pageNum <= 1 ? `${BASE_URL}${COLLECTION_PATH}` : `${BASE_URL}${COLLECTION_PATH}/page-${pageNum}`;
  const html = await fetchHtml(url);
  const nextData = extractNextData(html);
  const albums = nextData?.props?.pageProps?.data?.albums || [];
  const pagination = nextData?.props?.pageProps?.pagination || null;

  return {
    items: albums.map(mapAlbumSummary).filter((a) => a.path),
    hasNextPage: Boolean(pagination?.next),
  };
}

// El sitio no tiene ningun parametro de orden para /collection/{slug} (se
// probaron sort=/order=/sortBy= en vivo y ninguno cambia el resultado -- el
// orden viene fijo por como se armo la coleccion). La unica forma real de
// ordenar A-Z es traer toda la coleccion una vez y ordenarla nosotros; se
// cachea en memoria porque son 29 paginas (~679 items) y no tiene sentido
// volver a pedirlas en cada request.
const SORT_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 horas
const SORT_PAGE_SIZE = 24; // mismo per_page que ya trae la paginacion del sitio
let sortedCache = null; // { items, fetchedAt }
let sortedCachePromise = null;

async function fetchAllAlbumsForSort() {
  const all = [];
  let pageNum = 1;
  // Tope de seguridad: la coleccion tiene ~29 paginas hoy: 60 da margen sin
  // arriesgarse a un loop infinito si el sitio cambia de forma inesperada.
  const MAX_PAGES = 60;
  while (pageNum <= MAX_PAGES) {
    const { items, hasNextPage } = await fetchCollectionPage(pageNum);
    all.push(...items);
    if (!hasNextPage) break;
    pageNum += 1;
  }
  all.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
  return all;
}

async function getSortedAlbums() {
  const isFresh = sortedCache && Date.now() - sortedCache.fetchedAt < SORT_CACHE_TTL_MS;
  if (isFresh) return sortedCache.items;

  if (!sortedCachePromise) {
    sortedCachePromise = fetchAllAlbumsForSort()
      .then((items) => {
        sortedCache = { items, fetchedAt: Date.now() };
        return items;
      })
      .finally(() => {
        sortedCachePromise = null;
      });
  }
  return sortedCachePromise;
}

// options.sort: 'az' | 'za' para orden alfabetico (con cache, ver arriba);
// cualquier otro valor deja el orden por defecto de la coleccion.
async function getCollection(page = 1, options = {}) {
  const pageNum = Number(page) || 1;
  const { sort = null } = options;

  if (sort === "az" || sort === "za") {
    const sorted = sort === "za" ? [...(await getSortedAlbums())].reverse() : await getSortedAlbums();
    const start = (pageNum - 1) * SORT_PAGE_SIZE;
    const items = sorted.slice(start, start + SORT_PAGE_SIZE);
    return { items, hasNextPage: start + SORT_PAGE_SIZE < sorted.length };
  }

  return fetchCollectionPage(pageNum);
}

// Simply Hentai resuelve la busqueda por JS del lado del cliente (no viene en el
// HTML servido), asi que la "busqueda" filtra por titulo dentro de la coleccion
// en español (hasta 5 paginas) en vez de pegarle a un endpoint de busqueda real.
async function searchContent(query) {
  if (!query) {
    throw new ApiError(400, "El parametro de busqueda 'q' es requerido");
  }
  const normalized = query.toLowerCase();
  const collected = [];

  for (let page = 1; page <= 5; page++) {
    const { items, hasNextPage } = await getCollection(page);
    collected.push(...items.filter((item) => item.title.toLowerCase().includes(normalized)));
    if (!hasNextPage || collected.length >= 40) break;
  }

  return collected;
}

// mangaPath tiene la forma "{seriesSlug}/{slug}"
async function getMangaInfo(mangaPath) {
  const cleanPath = String(mangaPath || "").replace(/^\/+/, "");
  if (!cleanPath.includes("/")) {
    throw new ApiError(400, "Se requiere el path 'seriesSlug/slug' del album");
  }

  const url = `${BASE_URL}/${cleanPath}`;
  const html = await fetchHtml(url);
  const nextData = extractNextData(html);
  const manga = nextData?.props?.pageProps?.manga;
  if (!manga) {
    throw new ApiError(404, "No encontrado en Simply Hentai");
  }

  const genres = [
    ...new Set(
      [...(manga.tags || []).map((t) => t.title || t.name), ...(manga.parodies || []).map((t) => t.title || t.name)].filter(
        Boolean
      )
    ),
  ].slice(0, 15);

  return {
    id: String(manga.id),
    slug: manga.slug,
    title: manga.title,
    synopsis: manga.description || "",
    cover: manga.preview?.sizes?.full || manga.preview?.sizes?.giant_thumb || null,
    genres,
    // Es contenido tipo one-shot: un solo "capitulo" que es el album entero.
    chapters: [{ number: 1, uploadId: cleanPath, title: "Leer" }],
    url,
    source: "simplyhentai",
  };
}

// uploadId aca es el mismo "{seriesSlug}/{slug}" que devuelve getMangaInfo
async function getChapterPages(uploadId) {
  const cleanPath = String(uploadId || "").replace(/^\/+/, "");
  if (!cleanPath.includes("/")) {
    throw new ApiError(400, "uploadId invalido");
  }

  // La pagina de detalle normal solo trae una vista previa de las imagenes
  // (ej. 12 de 160). /all-pages es la unica ruta que trae el set completo,
  // pero bajo pageProps.data.pages en vez de pageProps.manga.images.
  const url = `${BASE_URL}/${cleanPath}/all-pages`;
  const html = await fetchHtml(url);
  const nextData = extractNextData(html);
  const data = nextData?.props?.pageProps?.data;
  if (!data) {
    throw new ApiError(404, "Capitulo no encontrado");
  }

  const pages = (data.pages || [])
    .slice()
    .sort((a, b) => a.page_num - b.page_num)
    .map((img) => img.sizes?.full || img.sizes?.giant_thumb || img.sizes?.thumb)
    .filter(Boolean);

  if (pages.length === 0) {
    throw new ApiError(404, "No se encontraron paginas para este capitulo");
  }

  return { uploadId: cleanPath, pages, title: data.title || "" };
}

// Precalienta el cache de orden alfabetico al arrancar el proceso (o al
// despertar tras dormirse en Render), asi el primer usuario que pida
// sort=az/za no es quien paga el costo de recorrer las 29 paginas en vivo.
getSortedAlbums().catch(() => {});

module.exports = {
  searchContent,
  getCollection,
  getMangaInfo,
  getChapterPages,
};
