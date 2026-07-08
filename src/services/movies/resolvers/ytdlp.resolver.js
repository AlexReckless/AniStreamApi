const { execFile } = require("node:child_process");

const YTDLP_ENABLED = process.env.YTDLP_ENABLED !== "false";
const YTDLP_TIMEOUT = Number(process.env.YTDLP_TIMEOUT_MS) || 8500;

let isAvailable = false;
let checked = false;

function debugLog(message, data) {
  const DEBUG = process.env.DEBUG_RESOLVER === "true";
  if (!DEBUG) return;
  console.log(`[${new Date().toISOString()}] [YTDLP] ${message}`, data ? (typeof data === "string" ? data.slice(0, 500) : data) : "");
}

function execYtdlp(args) {
  return new Promise((resolve, reject) => {
    execFile(
      "yt-dlp",
      args,
      { timeout: YTDLP_TIMEOUT, maxBuffer: 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          reject(err);
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

async function checkYtdlpAvailability() {
  if (!YTDLP_ENABLED) {
    isAvailable = false;
    checked = true;
    return false;
  }

  try {
    const { stdout, stderr } = await execYtdlp(["--version"]);
    const version = (stdout || stderr || "").trim();
    isAvailable = Boolean(version);
    if (isAvailable) {
      console.log(`[YTDLP] Detectado version: ${version}`);
    }
  } catch (err) {
    isAvailable = false;
  }

  checked = true;
  return isAvailable;
}

async function extractWithYtdlp(url, referer) {
  if (!YTDLP_ENABLED) return null;
  if (!checked) await checkYtdlpAvailability();
  if (!isAvailable) return null;

  debugLog("Resolviendo con yt-dlp", url);

  try {
    const args = ["-g", "--flat-playlist", "--no-check-certificates", "--socket-timeout", "8", "--referer", referer || url, url];
    const { stdout } = await execYtdlp(args);
    const lines = stdout.trim().split("\n").map((l) => l.trim()).filter(Boolean);

    for (const line of lines) {
      if (line.startsWith("http") && (line.includes(".m3u8") || line.includes(".mp4"))) {
        return line;
      }
    }

    if (lines.length > 0 && lines[0].startsWith("http")) {
      return lines[0];
    }

    return null;
  } catch (err) {
    debugLog("Error ejecutando yt-dlp", err.message);
    return null;
  }
}

module.exports = {
  get isAvailable() {
    return isAvailable;
  },
  checkYtdlpAvailability,
  extractWithYtdlp,
};
