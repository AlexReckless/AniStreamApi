// routes/missav.routes.js
const express = require("express");
const { requireApiKey } = require("../middlewares/auth");
const { dailyRateLimit } = require("../middlewares/rate-limit");
const missavService = require("../services/missav.service");
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

// Este router ya se monta en "/api/v1/missav" (ver server.js) -- las rutas
// de aca abajo van SIN ese prefijo repetido (antes tenian "/missav/..." acá
// adentro tambien, lo que las dejaba en "/api/v1/missav/missav/...").
router.use(requireApiKey, dailyRateLimit);

router.get(
  "/search",
  asyncHandler(async (req, res) => {
    if (!req.query.q) {
      throw new ApiError(400, "Se requiere el parametro q para buscar");
    }
    const response = await missavService.searchVideos(req.query.q, req.query.domain);
    res.status(200).json(response);
  })
);

router.get(
  "/info",
  asyncHandler(async (req, res) => {
    if (!req.query.url) {
      throw new ApiError(400, "Se requiere el parametro url");
    }
    const response = await missavService.getVideoInfo(req.query.url);
    res.status(200).json(response);
  })
);

router.get(
  "/links",
  asyncHandler(async (req, res) => {
    if (!req.query.url) {
      throw new ApiError(400, "Se requiere el parametro url");
    }
    const response = await missavService.getVideoLinks(req.query.url);
    res.status(200).json(response);
  })
);

router.get(
  "/catalog",
  asyncHandler(async (req, res) => {
    const response = await missavService.getCatalog({
      genre: req.query.genre,
      page: req.query.page,
      domain: req.query.domain,
    });
    res.status(200).json(response);
  })
);

router.get(
  "/genres",
  asyncHandler(async (req, res) => {
    const response = await missavService.getAvailableGenres(req.query.domain);
    res.status(200).json(response);
  })
);

// ── MissAV via el celular del usuario ───────────────────────────────
// missav.live esta detras de Cloudflare y bloquea la IP de Render (403,
// mismo problema que ya tenia MangaOni). En vez de pagar un proxy, la app
// le pide a este endpoint la URL exacta a pedir, la pide ELLA MISMA (con la
// IP real del usuario, que Cloudflare no bloquea) y manda el HTML de vuelta
// acá para que lo parseemos con el mismo cheerio que ya usa el fetch
// server-side (missav.service.js). Mismo patron que /mangaoni/fetch-url +
// /mangaoni/parse en manga.routes.js.
router.get(
  "/fetch-url",
  asyncHandler(async (req, res) => {
    const { type } = req.query;
    const baseUrl = missavService.resolveBaseUrl(req.query.domain);
    let url;

    if (type === "search") {
      url = missavService.buildSearchUrl(baseUrl, req.query.q);
    } else if (type === "catalog") {
      url = missavService.buildCatalogUrl(baseUrl, { genre: req.query.genre, page: req.query.page });
    } else if (type === "genres") {
      url = missavService.buildGenresUrl(baseUrl);
    } else if (type === "info" || type === "links") {
      // info/links ya llegan con la URL completa del video (la arma el
      // front a partir de un resultado previo de busqueda/catalogo) --
      // no hace falta construir nada, solo devolverla.
      if (!req.query.url) throw new ApiError(400, "Se requiere el parametro url");
      url = req.query.url;
    } else {
      throw new ApiError(400, "type invalido: usa search, catalog, genres, info o links");
    }

    res.status(200).json({ success: true, url });
  })
);

router.post(
  "/parse",
  // text/*: el body es el HTML crudo que trajo el celular, no JSON -- el
  // express.json() global (server.js) ignora esto porque el content-type no
  // matchea, asi que el stream le llega intacto a este parser.
  express.text({ type: "*/*", limit: "5mb" }),
  asyncHandler(async (req, res) => {
    const { type } = req.query;
    const html = req.body;
    if (!html || typeof html !== "string") {
      throw new ApiError(400, "Falta el HTML a parsear en el body de la peticion");
    }

    const baseUrl = missavService.resolveBaseUrl(req.query.domain);

    let data;
    if (type === "search") {
      data = missavService.parseSearchHtml(html, baseUrl, req.query.q || "");
    } else if (type === "catalog") {
      data = missavService.parseCatalogHtml(html, baseUrl, Number(req.query.page) || 1);
    } else if (type === "genres") {
      data = missavService.parseGenresHtml(html, baseUrl);
    } else if (type === "info") {
      if (!req.query.url) throw new ApiError(400, "Se requiere el parametro url");
      data = missavService.parseInfoHtml(html, req.query.url);
    } else if (type === "links") {
      data = missavService.parseLinksHtml(html);
    } else {
      throw new ApiError(400, "type invalido: usa search, catalog, genres, info o links");
    }

    res.status(200).json({ success: true, data, source: "missav" });
  })
);

module.exports = router;
