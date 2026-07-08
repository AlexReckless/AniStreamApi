const express = require("express");
const { requireApiKey } = require("../middlewares/auth");
const { dailyRateLimit } = require("../middlewares/rate-limit");
const pelisplusService = require("../services/movies/pelisplus.service");
const cuevanaService = require("../services/movies/cuevana.service");
const repelishdService = require("../services/movies/repelishd.service");
const { resolveEmbedUrl } = require("../services/movies/resolvers");
const { ApiError } = require("../utils/api-error");

const router = express.Router();

function asyncHandler(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

router.use(requireApiKey, dailyRateLimit);

/**
 * Buscar peliculas/series (agregado PelisPlus + RePelisHD, con fallback a Cuevana3)
 * GET /search?q=avatar
 */
router.get(
  "/search",
  asyncHandler(async (req, res) => {
    const query = req.query.q || req.query.s || "";
    if (!query) {
      throw new ApiError(400, "El parametro de busqueda 'q' es requerido");
    }

    let data = [];
    let source = "aggregate";

    try {
      const [ppData, rpData] = await Promise.all([
        pelisplusService.searchContent(query).catch((err) => {
          console.error("Error buscando en PelisPlus:", err.message);
          return [];
        }),
        repelishdService.searchContent(query).catch((err) => {
          console.error("Error buscando en RePelisHD:", err.message);
          return [];
        }),
      ]);

      const ppMapped = (ppData || []).map((item) => ({ ...item, provider: "pelisplus" }));
      const rpMapped = (rpData || []).map((item) => ({ ...item, provider: "repelishd" }));
      data = [...rpMapped, ...ppMapped];

      const lowerQuery = query.toLowerCase().trim();
      data.sort((a, b) => {
        const aTitle = a.title.toLowerCase();
        const bTitle = b.title.toLowerCase();
        const aExact = aTitle === lowerQuery;
        const bExact = bTitle === lowerQuery;
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;
        const aStarts = aTitle.startsWith(lowerQuery);
        const bStarts = bTitle.startsWith(lowerQuery);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return 0;
      });

      if (data.length > 0) source = rpMapped.length > 0 ? "repelishd" : "pelisplus";
    } catch (error) {
      console.error("Error en busqueda paralela:", error.message);
    }

    if (data.length === 0) {
      try {
        const cuevanaData = await cuevanaService.searchContent(query);
        data = (cuevanaData || []).map((item) => ({ ...item, provider: "cuevana3" }));
        source = "cuevana3";
      } catch (error) {
        console.error("Error buscando en Cuevana3:", error.message);
      }
    }

    res.status(200).json({ success: true, data, source });
  })
);

/**
 * Catalogo filtrado por tipo, genero y pagina
 * GET /catalog?type=movie|series|anime&genre=&page=1
 */
router.get(
  "/catalog",
  asyncHandler(async (req, res) => {
    const type = req.query.type || "movie";
    const genre = req.query.genre || "";
    const page = Number(req.query.page || 1);
    const premieres = req.query.estrenos === "true";

    const data = await pelisplusService.getCatalog(type, genre, page, premieres);
    if (data && data.items) {
      data.items = data.items.map((item) => ({ ...item, provider: "pelisplus" }));
    }

    res.status(200).json({ success: true, data, source: "pelisplus" });
  })
);

/**
 * Generos disponibles
 * GET /genres
 */
router.get(
  "/genres",
  asyncHandler(async (req, res) => {
    const data = await pelisplusService.getGenres();
    res.status(200).json({ success: true, data, source: "pelisplus" });
  })
);

/**
 * Detalle de una pelicula/serie (sinopsis, poster, temporadas/episodios o servidores)
 * GET /info/:slug?type=movie&provider=
 */
router.get(
  "/info/*",
  asyncHandler(async (req, res) => {
    const slug = req.params[0];
    const type = req.query.type || "movie";
    let provider = req.query.provider;

    if (!provider) {
      if (slug.includes("/") && !slug.startsWith("pelicula/") && !slug.startsWith("serie/") && !slug.startsWith("anime/")) {
        provider = "cuevana3";
      } else {
        provider = "pelisplus";
      }
    }

    let data;
    let source = provider;

    try {
      const service = provider === "cuevana3" ? cuevanaService : provider === "repelishd" ? repelishdService : pelisplusService;
      data = await service.getContentInfo(slug, type);
    } catch (error) {
      if (provider === "pelisplus") {
        try {
          data = await repelishdService.getContentInfo(slug, type);
          source = "repelishd";
        } catch (repelisError) {
          try {
            data = await cuevanaService.getContentInfo(slug, type);
            source = "cuevana3";
          } catch (cascadeError) {
            throw error;
          }
        }
      } else {
        throw error;
      }
    }

    if (data) data.provider = source;
    res.status(200).json({ success: true, data, source });
  })
);

/**
 * Servidores de reproduccion de un capitulo de serie
 * GET /servers?slug=&season=1&episode=1&provider=
 */
router.get(
  "/servers",
  asyncHandler(async (req, res) => {
    const slug = req.query.slug || req.query.serieSlug;
    const season = Number(req.query.season || 1);
    const episode = Number(req.query.episode || 1);
    let provider = req.query.provider;

    if (!slug) {
      throw new ApiError(400, "El parametro 'slug' de la serie es requerido");
    }

    if (!provider) {
      provider = slug.includes("/") ? "cuevana3" : "pelisplus";
    }

    let data;
    let source = provider;

    try {
      const service = provider === "cuevana3" ? cuevanaService : provider === "repelishd" ? repelishdService : pelisplusService;
      data = await service.getEpisodeServers(slug, season, episode);
    } catch (error) {
      if (provider === "pelisplus") {
        try {
          data = await repelishdService.getEpisodeServers(slug, season, episode);
          source = "repelishd";
        } catch (repelisError) {
          try {
            data = await cuevanaService.getEpisodeServers(slug, season, episode);
            source = "cuevana3";
          } catch (cascadeError) {
            throw error;
          }
        }
      } else {
        throw error;
      }
    }

    res.status(200).json({ success: true, data, source });
  })
);

/**
 * Resolver un embed a su URL directa de video (.mp4/.m3u8)
 * GET /resolve?url=https://streamwish.to/e/xxx
 */
router.get(
  "/resolve",
  asyncHandler(async (req, res) => {
    const embedUrl = req.query.url;
    const parentUrl = req.query.parentUrl || null;
    if (!embedUrl) {
      throw new ApiError(400, "Se requiere el parametro 'url' del embed");
    }

    const directUrl = await resolveEmbedUrl(embedUrl, parentUrl);
    res.status(200).json({ success: true, data: { embedUrl, directUrl } });
  })
);

module.exports = router;
