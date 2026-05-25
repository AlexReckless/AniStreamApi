const express = require("express");
const { requireApiKey } = require("../middlewares/auth");
const { dailyRateLimit } = require("../middlewares/rate-limit");
const animeService = require("../services/anime.service");
const downloadService = require("../services/download.service");
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

router.get(
  "/search",
  asyncHandler(async (req, res) => {
    const response = await animeService.searchAnime(req.query.q, req.query.domain);
    res.status(200).json(response);
  })
);

router.get(
  "/info",
  asyncHandler(async (req, res) => {
    if (!req.query.url) {
      throw new ApiError(400, "Se requiere el parametro url");
    }

    const response = await animeService.getAnimeInfo(req.query.url);
    res.status(200).json(response);
  })
);

router.get(
  "/episode",
  asyncHandler(async (req, res) => {
    if (!req.query.url) {
      throw new ApiError(400, "Se requiere el parametro url");
    }

    const response = await animeService.getEpisodeLinks(req.query.url, req.query.includeMega, req.query.excludeServers);
    res.status(200).json(response);
  })
);

router.post(
  "/download",
  asyncHandler(async (req, res) => {
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const data = downloadService.createDownload(req.body || {}, baseUrl);

    res.status(200).json({
      success: true,
      data,
    });
  })
);

router.get(
  "/download/:id",
  asyncHandler(async (req, res) => {
    const data = downloadService.getDownload(req.params.id);

    res.status(200).json({
      success: true,
      data,
    });
  })
);

router.post(
  "/batch-download",
  asyncHandler(async (req, res) => {
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const data = downloadService.createBatch(req.body || {}, baseUrl);

    res.status(200).json({
      success: true,
      data,
    });
  })
);

router.get(
  "/batch/:id",
  asyncHandler(async (req, res) => {
    const data = downloadService.getBatch(req.params.id);

    res.status(200).json({
      success: true,
      data,
    });
  })
);

module.exports = router;
