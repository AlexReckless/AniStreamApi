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

// Todas las rutas requieren API key y tienen límite de tasa
router.use(requireApiKey, dailyRateLimit);

// Búsqueda de videos
router.get(
  "/search",
  asyncHandler(async (req, res) => {
    if (!req.query.q) {
      throw new ApiError(400, "Se requiere el parámetro q para la búsqueda");
    }
    
    const page = req.query.page || 1;
    const response = await missavService.searchVideos(req.query.q, page);
    res.status(200).json(response);
  })
);

// Información de un video específico
router.get(
  "/info",
  asyncHandler(async (req, res) => {
    if (!req.query.url) {
      throw new ApiError(400, "Se requiere el parámetro url");
    }
    
    const response = await missavService.getVideoInfo(req.query.url);
    res.status(200).json(response);
  })
);

// Catálogo (página principal o con filtros)
router.get(
  "/catalog",
  asyncHandler(async (req, res) => {
    const response = await missavService.getCatalog({
      page: req.query.page || 1,
      filter: req.query.filter || 'new'
    });
    res.status(200).json(response);
  })
);

// Búsqueda con filtro de subtítulos en inglés (como la URL que mencionaste)
router.get(
  "/english-subtitle",
  asyncHandler(async (req, res) => {
    const page = req.query.page || 1;
    // Usamos el catálogo pero forzamos el filtro de subtítulos en inglés
    const response = await missavService.getCatalog({
      page,
      filter: 'english-subtitle'
    });
    res.status(200).json(response);
  })
);

module.exports = router;