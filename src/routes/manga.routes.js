const express = require("express");
const { requireApiKey } = require("../middlewares/auth");
const { dailyRateLimit } = require("../middlewares/rate-limit");
const { zonatmo, tmohentai } = require("../services/manga/tmo.service");
const simplyhentai = require("../services/manga/simplyhentai.service");
const kingcomix = require("../services/manga/kingcomix.service");
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

// El id nsfw:true es lo que el front usa para esconder ZonaTMO... (esconder TMOHentai/
// Simply Hentai) detras del gesto de 5 clicks en el logo, igual que "Hentaila" en anime.
const SOURCES = {
  zonatmo: { name: "ZonaTMO", nsfw: false, service: zonatmo },
  tmohentai: { name: "TMOHentai", nsfw: true, service: tmohentai },
  simplyhentai: { name: "Simply Hentai", nsfw: true, service: simplyhentai },
  kingcomix: { name: "KingComix", nsfw: true, service: kingcomix },
};

function getSource(sourceId) {
  const entry = SOURCES[sourceId];
  if (!entry) {
    throw new ApiError(400, `Fuente de manga desconocida: ${sourceId}`);
  }
  return entry;
}

router.use(requireApiKey, dailyRateLimit);

router.get("/sources", (_req, res) => {
  res.status(200).json({
    success: true,
    data: Object.entries(SOURCES).map(([id, s]) => ({ id, name: s.name, nsfw: s.nsfw })),
  });
});

router.get(
  "/search",
  asyncHandler(async (req, res) => {
    const { source, q } = req.query;
    if (!q) {
      throw new ApiError(400, "El parametro 'q' es requerido");
    }
    const { service } = getSource(source);
    const data = await service.searchContent(q);
    res.status(200).json({ success: true, data, source });
  })
);

router.get(
  "/catalog",
  asyncHandler(async (req, res) => {
    const { source } = req.query;
    const page = Number(req.query.page || 1);
    const { service } = getSource(source);

    // zonatmo/tmohentai devuelven un array plano; simplyhentai ya devuelve {items, hasNextPage}.
    const raw = service.getCatalog ? await service.getCatalog(page) : await service.getCollection(page);
    const data = Array.isArray(raw) ? { items: raw, hasNextPage: raw.length > 0 } : raw;

    res.status(200).json({ success: true, data, source });
  })
);

router.get(
  "/manga/:source/*",
  asyncHandler(async (req, res) => {
    const { source } = req.params;
    const mangaPath = req.params[0];
    const { service } = getSource(source);
    const data = await service.getMangaInfo(mangaPath);
    res.status(200).json({ success: true, data, source });
  })
);

router.get(
  "/chapter/:source/*",
  asyncHandler(async (req, res) => {
    const { source } = req.params;
    const uploadId = req.params[0];
    const { service } = getSource(source);
    const data = await service.getChapterPages(uploadId);
    res.status(200).json({ success: true, data, source });
  })
);

module.exports = router;
