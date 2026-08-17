const axios = require("axios");
const cheerio = require("cheerio");
const { ApiError } = require("../utils/api-error");

const DEFAULT_DOMAIN = "missav.live";

const HTTP_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
};

async function fetchHtml(url) {
  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: HTTP_HEADERS,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400,
    });
    return response.data;
  } catch (error) {
    throw new ApiError(500, "No se pudo obtener contenido desde MissAV", error.message);
  }
}

function extractVideoInfo(html) {
  const $ = cheerio.load(html);
  
  // Extraer información del video
  const title = $('h1').first().text().trim() || 
                $('meta[property="og:title"]').attr('content') || 
                'Sin título';
  
  const description = $('meta[name="description"]').attr('content') || 
                     $('meta[property="og:description"]').attr('content') || 
                     '';
  
  const image = $('meta[property="og:image"]').attr('content') || 
                $('video').attr('poster') || 
                null;
  
  // Extraer información de la actriz
  const actress = $('.actress-name, .actor-name, [class*="actress"]').first().text().trim() || null;
  
  // Extraer tags/categorías
  const tags = [];
  $('.tag, .genre, [class*="tag"], [class*="genre"]').each((_, el) => {
    const tag = $(el).text().trim();
    if (tag) tags.push(tag);
  });
  
  // Extraer información de la página (paginación)
  const currentPage = parseInt($('.pagination .active').text()) || 1;
  const totalPages = parseInt($('.pagination .page-item:not(.active):not(.disabled)').last().text()) || currentPage;
  
  // Extraer enlaces de video (los iframes de los reproductores)
  const videoSources = [];
  $('iframe[src*="embed"], iframe[src*="player"], iframe[src*="video"]').each((_, el) => {
    const src = $(el).attr('src');
    if (src) {
      videoSources.push({
        url: src,
        type: 'iframe',
        server: new URL(src).hostname.replace('www.', '')
      });
    }
  });
  
  // También buscar enlaces directos de video
  $('video source, source[src*=".mp4"], source[src*=".m3u8"]').each((_, el) => {
    const src = $(el).attr('src');
    if (src) {
      videoSources.push({
        url: src,
        type: 'direct',
        quality: $(el).attr('label') || $(el).attr('res') || 'unknown'
      });
    }
  });
  
  // Extraer información de series
  const series = [];
  $('.series-item, .related-item, [class*="series"]').each((_, el) => {
    const link = $(el).find('a').first();
    const href = link.attr('href');
    const title = link.text().trim() || $(el).find('img').attr('alt') || '';
    const img = $(el).find('img').attr('src') || null;
    
    if (href && title) {
      series.push({
        title,
        url: href.startsWith('http') ? href : `https://${DEFAULT_DOMAIN}${href}`,
        image: img
      });
    }
  });
  
  // Extraer información de la página actual (para el catálogo)
  const items = [];
  $('.video-item, .movie-item, [class*="video-item"], [class*="movie-item"]').each((_, el) => {
    const link = $(el).find('a').first();
    const href = link.attr('href');
    const title = link.text().trim() || $(el).find('img').attr('alt') || '';
    const img = $(el).find('img').attr('src') || null;
    
    if (href && title) {
      items.push({
        title,
        url: href.startsWith('http') ? href : `https://${DEFAULT_DOMAIN}${href}`,
        image: img,
        description: $(el).find('.description, .summary, .info').first().text().trim() || null
      });
    }
  });
  
  return {
    title,
    description,
    image,
    actress,
    tags,
    currentPage,
    totalPages,
    videoSources,
    series,
    items,
    hasNextPage: currentPage < totalPages
  };
}

async function searchVideos(query, page = 1) {
  if (!query || query.trim().length === 0) {
    throw new ApiError(400, "Se requiere el parámetro de búsqueda");
  }
  
  const searchUrl = `https://${DEFAULT_DOMAIN}/search/${encodeURIComponent(query.trim())}?page=${page}`;
  const html = await fetchHtml(searchUrl);
  const data = extractVideoInfo(html);
  
  return {
    success: true,
    data: {
      query: query.trim(),
      page: parseInt(page) || 1,
      totalPages: data.totalPages || 1,
      results: data.items || [],
      hasNextPage: data.hasNextPage || false
    }
  };
}

async function getVideoInfo(url) {
  if (!url) {
    throw new ApiError(400, "Se requiere el parámetro url");
  }
  
  // Si la URL es relativa, construirla completa
  let fullUrl = url;
  if (!url.startsWith('http')) {
    fullUrl = `https://${DEFAULT_DOMAIN}${url.startsWith('/') ? '' : '/'}${url}`;
  }
  
  const html = await fetchHtml(fullUrl);
  const data = extractVideoInfo(html);
  
  return {
    success: true,
    data: {
      ...data,
      url: fullUrl
    }
  };
}

async function getCatalog({ page = 1, filter = 'new' }) {
  // Modo catálogo: usar la página principal o con filtros
  let catalogUrl = `https://${DEFAULT_DOMAIN}/dm23/en/english-subtitle?page=${page}`;
  
  // Si hay un filtro adicional, se puede agregar
  if (filter === 'popular') {
    catalogUrl = `https://${DEFAULT_DOMAIN}/popular?page=${page}`;
  } else if (filter === 'trending') {
    catalogUrl = `https://${DEFAULT_DOMAIN}/trending?page=${page}`;
  }
  
  const html = await fetchHtml(catalogUrl);
  const data = extractVideoInfo(html);
  
  return {
    success: true,
    data: {
      page: parseInt(page) || 1,
      totalPages: data.totalPages || 1,
      filter: filter || 'new',
      results: data.items || [],
      hasNextPage: data.hasNextPage || false
    }
  };
}

module.exports = {
  searchVideos,
  getVideoInfo,
  getCatalog,
  fetchHtml,
  extractVideoInfo
};