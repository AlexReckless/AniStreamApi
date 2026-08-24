// services/missav.service.js
const axios = require("axios");
const cheerio = require("cheerio");
const { URL } = require("node:url");
const { ApiError } = require("../utils/api-error");

const HTML_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
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
    throw new ApiError(500, `No se pudo obtener contenido de MissAV: ${error.message}`, error.message);
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

// ── Decoder del empaquetador "Dean Edwards packer" ─────────────────────────
// El player real NO pone el .m3u8 en un <video>/<source> -- lo esconde en un
// bloque `eval(function(p,a,c,k,e,d){...})('payload',radix,count,'k1|k2|...'
// .split('|'),0,{}))` incrustado en la pagina. Se reimplementa el algoritmo
// de desempaquetado a mano (verificado contra HTML real bajado en vivo) en
// vez de usar eval() sobre contenido de un tercero.
function decodePacked(payload, radix, count, keywords) {
  const dict = {};
  function baseN(c) {
    return (
      (c < radix ? "" : baseN(Math.floor(c / radix))) +
      ((c % radix) > 35 ? String.fromCharCode((c % radix) + 29) : (c % radix).toString(36))
    );
  }
  for (let c = count - 1; c >= 0; c--) {
    dict[baseN(c)] = keywords[c] || baseN(c);
  }
  return payload.replace(/\b\w+\b/g, (word) => (Object.prototype.hasOwnProperty.call(dict, word) ? dict[word] : word));
}

// El payload empacado trae comillas simples escapadas ("\'", porque adentro
// hay asignaciones JS con sus propias strings) -- el regex las respeta para
// no cortar el match antes de tiempo.
const PACKER_RE = /eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('((?:\\.|[^'\\])*)',(\d+),(\d+),'((?:\\.|[^'\\])*)'\.split\('\|'\)/g;

// La pagina trae MAS de un bloque empacado (uno con las URLs .m3u8 del
// video, otro con un script de anti-hotlink/dominio que no nos interesa) --
// se decodifican todos y se junta cualquier URL .m3u8 que aparezca.
function extractStreamUrls(html) {
  const urls = new Set();
  PACKER_RE.lastIndex = 0;
  let match;
  while ((match = PACKER_RE.exec(html))) {
    const [, rawPayload, radix, count, keywordsStr] = match;
    try {
      const payload = rawPayload.replace(/\\'/g, "'");
      const decoded = decodePacked(payload, Number(radix), Number(count), keywordsStr.split("|"));
      const found = decoded.match(/https?:\/\/[^\s'";]+\.m3u8/g);
      if (found) found.forEach((u) => urls.add(u));
    } catch (_error) {
      // bloque no relacionado al video (ads/anti-hotlink) -- se ignora
    }
  }
  return Array.from(urls);
}

// ── Cards de listado (busqueda/genero/seccion -- mismo template) ───────────
// Verificado en vivo: cada card es <div class="thumbnail">...<a href=".../
// {id}">...<img data-src="{cover}">...<span class="absolute...">{duracion}
// </span>...<a class="text-secondary">{titulo}</a></div>.
function parseVideoCards(html, baseUrl) {
  const $ = cheerio.load(html);
  const items = [];

  $(".thumbnail").each((_, el) => {
    const element = $(el);
    const href = element.find("a[href]").first().attr("href") || "";
    if (!href) return;
    const id = href.split("/").filter(Boolean).pop();
    if (!id) return;

    const img = element.find("img").first();
    const rawSrc = img.attr("src") || "";
    const cover = img.attr("data-src") || (rawSrc.startsWith("data:") ? "" : rawSrc);
    const title = element.find("a.text-secondary").first().text().trim() || img.attr("alt") || id;
    const duration = element.find("span.absolute").first().text().trim() || null;

    items.push({
      id,
      title,
      cover: getAbsoluteUrl(baseUrl, cover),
      duration,
      url: getAbsoluteUrl(baseUrl, href),
      source: "missav",
    });
  });

  return items;
}

class MissAVService {
  constructor() {
    this.baseUrl = "https://missav.live";
    this.source = "missav";
  }

  async searchVideos(query, domain = null) {
    if (!query || query.trim().length < 2) {
      throw new ApiError(400, "El parámetro de búsqueda 'q' es requerido (mínimo 2 caracteres)");
    }
    const baseUrl = domain ? `https://${domain}` : this.baseUrl;
    // La busqueda real es "/en/search/{keyword}" (path, NO "?q="): el sitio
    // la resuelve del lado del cliente (Alpine.js `search(keyword)` hace
    // `location.href = '/en/search/'+keyword`) -- "?q=" nunca fue un
    // endpoint real, siempre devolvia 404.
    const searchUrl = `${baseUrl}/en/search/${encodeURIComponent(query.trim())}`;
    const html = await fetchHtml(searchUrl);
    const results = parseVideoCards(html, baseUrl);

    return {
      success: true,
      source: this.source,
      data: { query: query.trim(), count: results.length, results },
    };
  }

  async getCatalog({ genre = null, page = 1, domain = null }) {
    const baseUrl = domain ? `https://${domain}` : this.baseUrl;
    const pageNum = Math.max(1, Number(page) || 1);
    // El sitio no tiene un "catalogo general" plano -- se navega por genero
    // ("/en/genres/{genero}") o, sin genero, por la seccion "English
    // Subtitle" ("/en/english-subtitle"); ambas paginan con "?page=N" y
    // comparten el mismo template de card que parseVideoCards ya entiende.
    const path = genre ? `/en/genres/${encodeURIComponent(genre)}` : "/en/english-subtitle";
    const catalogUrl = `${baseUrl}${path}${pageNum > 1 ? `?page=${pageNum}` : ""}`;
    const html = await fetchHtml(catalogUrl);
    const videos = parseVideoCards(html, baseUrl);

    return {
      success: true,
      source: this.source,
      data: {
        page: pageNum,
        hasNextPage: /rel="next"/.test(html),
        totalItems: videos.length,
        videos,
      },
    };
  }

  async getAvailableGenres(domain = null) {
    const baseUrl = domain ? `https://${domain}` : this.baseUrl;
    try {
      const html = await fetchHtml(`${baseUrl}/en/genres`);
      const $ = cheerio.load(html);
      const genres = [];
      const seen = new Set();

      $('a[href*="/genres/"]').each((_, el) => {
        const href = $(el).attr("href") || "";
        const match = href.match(/\/genres\/([^/?#]+)/);
        if (!match) return;
        const slug = match[1];
        if (seen.has(slug)) return;
        const name = $(el).text().trim();
        if (!name) return;
        seen.add(slug);
        genres.push({ id: decodeURIComponent(slug), name, url: getAbsoluteUrl(baseUrl, href) });
      });

      return { success: true, source: this.source, data: { genres } };
    } catch (_error) {
      return { success: true, source: this.source, data: { genres: [] } };
    }
  }

  async getVideoInfo(url) {
    if (!url) {
      throw new ApiError(400, "Se requiere la URL del video");
    }

    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    const title = $("h1").first().text().trim() || $('meta[property="og:title"]').attr("content") || "";
    if (!title) {
      throw new ApiError(404, "Video no encontrado en MissAV");
    }

    const cover = $('meta[property="og:image"]').attr("content") || "";
    const description =
      $('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content") || "";

    // Filas de metadatos: <div class="text-secondary"><span>Label:</span>
    // {valor}</div> -- "valor" es uno-o-mas <a> (Actress/Genre/Tag/Maker/
    // Director/Label) o un <time>/<span class="font-medium"> suelto
    // (Release date/Code/Title). No todos los videos tienen todas las filas
    // (los FC2 amateur no tienen Actress/Genre/Maker, por ejemplo).
    const meta = {};
    $(".text-secondary").each((_, el) => {
      const row = $(el);
      const label = row.find("span").first().text().trim().replace(/:$/, "");
      if (!label) return;
      const links = row.find("a");
      if (links.length > 0) {
        meta[label] = links
          .map((__, a) => $(a).text().trim())
          .get()
          .filter(Boolean);
      } else {
        meta[label] = row.find("time, span.font-medium").first().text().trim();
      }
    });

    const streams = extractStreamUrls(html);

    const videoInfo = {
      id: url.split("/").filter(Boolean).pop(),
      title,
      cover,
      description,
      code: meta.Code || null,
      releaseDate: meta["Release date"] || null,
      actresses: Array.isArray(meta.Actress) ? meta.Actress : [],
      genres: Array.isArray(meta.Genre) ? meta.Genre : [],
      tags: Array.isArray(meta.Tag) ? meta.Tag : [],
      maker: Array.isArray(meta.Maker) ? meta.Maker[0] : meta.Maker || null,
      director: Array.isArray(meta.Director) ? meta.Director[0] : meta.Director || null,
      hasStreams: streams.length > 0,
      url,
      source: this.source,
    };

    return { success: true, source: this.source, data: videoInfo };
  }

  async getVideoLinks(url) {
    if (!url) {
      throw new ApiError(400, "Se requiere la URL del video");
    }

    const html = await fetchHtml(url);
    const title = cheerio.load(html)("h1").first().text().trim() || "Video";

    // El sitio no tiene "servidores" alternativos como los scrapers de
    // anime (Mega, mirrors, etc.) -- el player oficial saca un master
    // playlist HLS (.m3u8, CDN surrit.com) de un bloque de JS empacado en
    // la propia pagina (ver extractStreamUrls). Es un solo stream HLS
    // reproducible directo, mismo tipo de fuente que ya usa IptvPlayerScreen
    // en la app -- no hace falta WebView ni iframe.
    const streams = extractStreamUrls(html);
    if (streams.length === 0) {
      throw new ApiError(404, "No se encontraron enlaces de video para esta URL");
    }
    const master = streams.find((u) => u.includes("playlist.m3u8")) || streams[0];

    return {
      success: true,
      source: this.source,
      data: {
        title,
        hls: master,
        variants: streams.filter((u) => u !== master),
      },
    };
  }
}

module.exports = new MissAVService();
