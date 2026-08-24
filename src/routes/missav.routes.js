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

module.exports = router;
