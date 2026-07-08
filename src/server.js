require("dotenv").config();

const path = require("node:path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const animeRoutes = require("./routes/anime.routes");
const moviesRoutes = require("./routes/movies.routes");
const mangaRoutes = require("./routes/manga.routes");
const downloadService = require("./services/download.service");
const { ApiError } = require("./utils/api-error");

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

const downloadsDir = downloadService.getDownloadsDir();
const staticDownloadOptions = {
  index: false,
  fallthrough: false,
  setHeaders: (res, filePath) => {
    res.setHeader("Content-Disposition", `attachment; filename=\"${path.basename(filePath)}\"`);
  },
};

app.use("/downloads", express.static(downloadsDir, staticDownloadOptions));
app.use("/api/downloads", express.static(downloadsDir, staticDownloadOptions));

app.get("/", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Anime1v API backend reconstruido",
    version: "1.0.0",
    endpoints: {
      modern: ["/api/v1/anime/search", "/api/v1/anime/info", "/api/v1/anime/episode"],
      legacy: ["/api/anime1v/search", "/api/anime1v/info", "/api/anime1v/episode"],
      movies: ["/api/v1/movies/search", "/api/v1/movies/catalog", "/api/v1/movies/info", "/api/v1/movies/servers", "/api/v1/movies/resolve"],
      manga: ["/api/v1/manga/sources", "/api/v1/manga/search", "/api/v1/manga/catalog", "/api/v1/manga/manga/:source/*", "/api/v1/manga/chapter/:source/*"],
    },
  });
});

app.get("/health", (_req, res) => {
  res.status(200).json({ success: true, status: "ok" });
});

app.use("/api/v1/anime", animeRoutes);
app.use("/api/anime1v", animeRoutes);
app.use("/api/v1/movies", moviesRoutes);
app.use("/api/v1/manga", mangaRoutes);

app.use((_req, _res, next) => {
  next(new ApiError(404, "Endpoint no encontrado"));
});

app.use((error, _req, res, _next) => {
  const statusCode = error.statusCode || 500;

  const response = {
    success: false,
    message: error.message || "Error interno del servidor",
  };

  if (process.env.NODE_ENV !== "production" && error.details) {
    response.error = error.details;
  }

  res.status(statusCode).json(response);
});

const ytdlpResolver = require("./services/movies/resolvers/ytdlp.resolver");
ytdlpResolver.checkYtdlpAvailability().then(() => {
  if (ytdlpResolver.isAvailable) {
    console.log("[SYSTEM] yt-dlp detectado. Se usara como resolvedor primario para movies.");
  } else {
    console.log("[SYSTEM] yt-dlp no disponible. Movies usara Puppeteer como fallback.");
  }
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Anime1v API listening on http://localhost:${port}`);
});
