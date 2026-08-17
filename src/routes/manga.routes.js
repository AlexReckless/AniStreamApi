const express = require("express");
const { requireApiKey } = require("../middlewares/auth");
const { dailyRateLimit } = require("../middlewares/rate-limit");
const { tmohentai } = require("../services/manga/tmo.service");
const simplyhentai = require("../services/manga/simplyhentai.service");
const olympus = require("../services/manga/olympus.service");
const ehentai = require("../services/manga/ehentai.service");
const infinitymanga = require("../services/manga/infinitymanga.service");
const mangaoni = require("../services/manga/mangaoni.service");
const hentai3 = require("../services/manga/3hentai.service");
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
  infinitymanga: { name: "InfinityManga", nsfw: false, service: infinitymanga },
  mangaoni: { name: "MangaOni", nsfw: false, service: mangaoni },
  tmohentai: { name: "TMOHentai", nsfw: true, service: tmohentai },
  simplyhentai: { name: "Simply Hentai", nsfw: true, service: simplyhentai },
  ehentai: { name: "E-Hentai", nsfw: true, service: ehentai },
  "3hentai": { name: "3Hentai", nsfw: true, service: hentai3 },
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

const VALID_SORTS = new Set(["az", "za"]);

router.get(
  "/catalog",
  asyncHandler(async (req, res) => {
    const { source } = req.query;
    const page = Number(req.query.page || 1);
    const { service } = getSource(source);

    // genres/sort solo los usan tmohentai (genres+sort) y simplyhentai (solo
    // sort) por ahora -- las demas fuentes no declaran un segundo parametro
    // en getCatalog/getCollection, asi que este objeto simplemente lo ignoran.
    const sort = VALID_SORTS.has(req.query.sort) ? req.query.sort : null;
    const genres = String(req.query.genres || "")
      .split(",")
      .map((id) => Number(id.trim()))
      .filter((id) => Number.isFinite(id));
    const options = { sort, tagIds: genres };

    // zonatmo/tmohentai devuelven un array plano; simplyhentai ya devuelve {items, hasNextPage}.
    const raw = service.getCatalog
      ? await service.getCatalog(page, options)
      : await service.getCollection(page, options);
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

// ── MangaOni via el celular del usuario ─────────────────────────
// manga-oni.com esta detras de Cloudflare y bloquea la IP de Render (mismo
// problema que ZonaTMO/KingComix antes). En vez de pagar un proxy, la app le
// pide a este endpoint la URL exacta a pedir, la pide ELLA MISMA (con la IP
// real del usuario, que Cloudflare no bloquea) y manda el HTML de vuelta acá
// para que lo parseemos con el mismo cheerio que ya usa el fetch server-side
// (mangaoni.service.js). Solo se usa para esta fuente -- las demas (sin
// bloqueo de Cloudflare) siguen scrapeando directo desde Render arriba.
router.get(
  "/mangaoni/fetch-url",
  asyncHandler(async (req, res) => {
    const { type } = req.query;
    let url;

    if (type === "catalog") {
      const sort = VALID_SORTS.has(req.query.sort) ? req.query.sort : null;
      const generoId = Number(req.query.genero);
      url = mangaoni.buildCatalogUrl(Number(req.query.page) || 1, {
        tagIds: Number.isFinite(generoId) ? [generoId] : [],
        sort,
      });
    } else if (type === "search") {
      url = mangaoni.buildSearchUrl(req.query.q);
    } else if (type === "info") {
      url = mangaoni.buildInfoUrl(req.query.tipo, req.query.slug);
    } else if (type === "chapter") {
      url = mangaoni.buildChapterUrl(req.query.slug, req.query.chapterId);
    } else {
      throw new ApiError(400, "type invalido: usa catalog, search, info o chapter");
    }

    res.status(200).json({ success: true, url });
  })
);

router.post(
  "/mangaoni/parse",
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

    let data;
    if (type === "catalog") {
      data = mangaoni.parseCatalogHtml(html);
    } else if (type === "search") {
      data = mangaoni.parseCatalogHtml(html).items;
    } else if (type === "info") {
      data = mangaoni.parseInfoHtml(html, req.query.tipo, req.query.slug);
    } else if (type === "chapter") {
      data = mangaoni.parseChapterHtml(html, req.query.uploadId);
    } else {
      throw new ApiError(400, "type invalido: usa catalog, search, info o chapter");
    }

    res.status(200).json({ success: true, data, source: "mangaoni" });
  })
);

module.exports = router;
