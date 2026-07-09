const express = require("express");
const axios = require("axios");
const { requireApiKey } = require("../middlewares/auth");
const { dailyRateLimit } = require("../middlewares/rate-limit");
const { tmohentai } = require("../services/manga/tmo.service");
const simplyhentai = require("../services/manga/simplyhentai.service");
const olympus = require("../services/manga/olympus.service");
const ehentai = require("../services/manga/ehentai.service");
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

// El id nsfw:true es lo que el front usa para esconder TMOHentai/Simply Hentai/
// E-Hentai detras del gesto de 5 clicks en el logo, igual que "Hentaila" en anime.
// ZonaTMO y KingComix se reemplazaron por Olympus y E-Hentai: ambos bloqueaban
// con 403 la IP de Render (Cloudflare), estos dos no.
const SOURCES = {
  olympus: { name: "Olympus Scanlation", nsfw: false, service: olympus },
  tmohentai: { name: "TMOHentai", nsfw: true, service: tmohentai },
  simplyhentai: { name: "Simply Hentai", nsfw: true, service: simplyhentai },
  ehentai: { name: "E-Hentai", nsfw: true, service: ehentai },
};

function getSource(sourceId) {
  const entry = SOURCES[sourceId];
  if (!entry) {
    throw new ApiError(400, `Fuente de manga desconocida: ${sourceId}`);
  }
  return entry;
}

router.use(requireApiKey, dailyRateLimit);

// TEMPORAL: para diagnosticar bloqueos de IP contra candidatos de fuentes nuevas.
// Sacar despues de terminar de elegir reemplazo/agregado (mismo patron que se
// uso antes para reemplazar ZonaTMO/KingComix).
router.get(
  "/debug-fetch",
  asyncHandler(async (req, res) => {
    const urls = String(req.query.urls || "").split(",").filter(Boolean);
    const results = await Promise.all(
      urls.map(async (url) => {
        try {
          const r = await axios.get(url, {
            timeout: 10000,
            maxRedirects: 5,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            },
            validateStatus: () => true,
          });
          const body = String(r.data || "");
          const cfChallenge = /Just a moment|cf-please-wait|Checking your browser|__cf_chl_/i.test(body);
          return { url, status: r.status, length: body.length, cfChallenge, server: r.headers?.server };
        } catch (error) {
          return { url, error: error.message };
        }
      })
    );
    res.json({ results });
  })
);

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
