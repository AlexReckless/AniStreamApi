const cheerio = require("cheerio");
const { URL } = require("node:url");
const { fetchHtmlWithHeaders, findFirstUrl, isLikelyVideoUrl, normalizeExtractedUrl } = require("./http");

const { getBrowser } = require("./browser");

const ytdlpResolver = require("./resolvers/ytdlp.resolver");
const { extractVoe } = require("./resolvers/voe.resolver");
const { extractStreamwish } = require("./resolvers/streamwish.resolver");
const { extractStreamtape } = require("./resolvers/streamtape.resolver");

const DEBUG_MODE = process.env.DEBUG_RESOLVER === "true";

function debugLog(server, message, data) {
  if (!DEBUG_MODE) return;
  const header = `[${new Date().toISOString()}] [${server}] ${message}`;
  if (data) {
    console.log(header, typeof data === "string" ? data.slice(0, 500) : data);
  } else {
    console.log(header);
  }
}

function getRefererForUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}/`;
  } catch (_error) {
    return "https://www.pelisplushd.la/";
  }
}

async function resolveEmbedWithPuppeteer(url, referer) {
  debugLog("Puppeteer", "Resolviendo URL", url);
  try {
    const browser = await getBrowser();
    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );

    if (referer) {
      await page.setExtraHTTPHeaders({ Referer: referer });
    }

    await page.setRequestInterception(true);

    let interceptedUrl = null;
    page.on("request", (req) => {
      const rUrl = req.url();
      const type = req.resourceType();

      const isMedia = /\.(?:m3u8|mp4)(?:\?|#|$)/i.test(rUrl);
      if (!interceptedUrl && type !== "document" && isMedia && !rUrl.startsWith("blob:") && !rUrl.includes("blank")) {
        interceptedUrl = rUrl;
      }

      const blockTypes = ["image", "stylesheet", "font"];
      if (blockTypes.includes(type)) {
        req.abort();
        return;
      }

      const isAd =
        /(google-analytics|doubleclick|adsterra|exoclick|popads|propellerads|clickadu|popcash|adnxs|mgid|outbrain|taboola|histats|amung|jads|ero-advertising|realsrv|admaven|coinhive|monetize|track|adshost|adsrv|a.bestcontent|a.shorte)/i.test(
          rUrl
        );
      if (isAd || (type === "script" && !rUrl.includes("player") && !rUrl.includes("video") && !rUrl.includes("jwplatform") && !rUrl.includes("plyr"))) {
        req.abort();
        return;
      }

      req.continue();
    });

    await page.goto(url, { waitUntil: "networkidle2", timeout: 15000 });

    try {
      const playBtnSelectors = ".play-button, button, .vjs-big-play-button, [role='button'], .jw-icon-display, .plyr__control--overlaid";
      const playBtn = await page.$(playBtnSelectors);
      if (playBtn) await playBtn.click();
    } catch (e) {}

    await new Promise((r) => setTimeout(r, 4000));

    if (!interceptedUrl) {
      for (const frame of page.frames()) {
        try {
          const playBtn = await frame.$(
            ".play-button, button, .vjs-big-play-button, [role='button'], .jw-icon-display, .plyr__control--overlaid"
          );
          if (playBtn) await playBtn.click();
        } catch (e) {}
      }
      await new Promise((r) => setTimeout(r, 3000));
    }

    if (interceptedUrl) {
      await page.close();
      return interceptedUrl;
    }

    const html = await page.content();
    await page.close();

    const $ = cheerio.load(html);

    const patterns = [
      /sources?\s*:\s*\[\s*\{[^}]*(?:file|src)\s*:\s*['"]([^'"]+)['"]/i,
      /"file"\s*:\s*"([^"]+)"/i,
      /"source"\s*:\s*"([^"]+)"/i,
      /"video"\s*:\s*"([^"]+)"/i,
      /(https?:\/\/[^\s"'>]+\.(?:mp4|m3u8)[^\s"'>]*)/i,
      /video\s*src\s*=\s*["']([^"']+)["']/i,
      /source\s+src\s*=\s*["']([^"']+)["']/i,
      /data-src\s*=\s*["']([^"']+)["']/i,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && match[1] && isLikelyVideoUrl(match[1])) {
        return match[1];
      }
    }

    const videoSrc = $("video").attr("src");
    if (videoSrc && isLikelyVideoUrl(videoSrc)) {
      return videoSrc;
    }

    const dataElements = $("[data-src], [data-source], [data-video], [data-file]");
    for (let i = 0; i < dataElements.length; i++) {
      const dataSrc = $(dataElements[i]).attr("data-src") || $(dataElements[i]).attr("data-source");
      if (dataSrc && isLikelyVideoUrl(dataSrc)) {
        return dataSrc;
      }
    }

    return null;
  } catch (err) {
    debugLog("Puppeteer", "Error", err.message);
    return null;
  }
}

async function resolveVidhideUrl(url, referer) {
  try {
    const { html } = await fetchHtmlWithHeaders(url, referer);
    return findFirstUrl(html, [
      /sources?\s*:\s*\[\s*\{[^}]*(?:file|src)\s*:\s*["'](https?:\/\/[^"']+)["']/i,
      /"file"\s*:\s*"([^"]+)"/i,
      /"source"\s*:\s*"([^"]+)"/i,
      /file\s*:\s*'([^']+)'/i,
      /setup\([^)]*file[^)]*\)/i,
    ]);
  } catch (err) {
    debugLog("Vidhide", "Error", err.message);
    return null;
  }
}

async function resolveHqqUrl(url, referer) {
  try {
    const { html } = await fetchHtmlWithHeaders(url, referer);
    return findFirstUrl(html, [
      /sources?\s*:\s*\[\s*\{[^}]*file\s*:\s*["'](https?:\/\/[^"']+)["']/i,
      /file\s*:\s*"([^"]+\.mp4[^"]*)"/i,
      /video(?:\d+)?\s*=\s*["']([^"']+\.mp4[^"']+)["']/i,
    ]);
  } catch (err) {
    debugLog("Hqq/Netu", "Error", err.message);
    return null;
  }
}

async function resolveMixdropUrl(url, referer) {
  try {
    const { html } = await fetchHtmlWithHeaders(url, referer);

    const patterns = [
      /MDCore\.wurl\s*=\s*"([^"]+)"/i,
      /MDCore\.vsrc\s*=\s*"([^"]+)"/i,
      /MDCore\.source\s*=\s*"([^"]+)"/i,
      /\|MDCore\|[^|]*\|wurl\|[^|]*\|(https?[^|]+)/i,
      /(https?:\/\/[a-z0-9]+\.mixdrop\.[a-z]+\/[^\s"'<>]+\.mp4[^\s"'<>]*)/i,
      /(https?:\/\/[a-z0-9]+\.mxdcontent\.[a-z]+\/[^\s"'<>]+\.mp4[^\s"'<>]*)/i,
      /"(https?:\/\/[^"]+\.mp4[^"]*)"/i,
      /\/\/(s-delivery\d+[^\s"']+\.mp4[^\s"']*)/i,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        let candidate = match[1];
        if (candidate.startsWith("//")) candidate = `https:${candidate}`;
        if (isLikelyVideoUrl(candidate)) return normalizeExtractedUrl(candidate);
      }
    }
    return null;
  } catch (err) {
    debugLog("Mixdrop", "Error", err.message);
    return null;
  }
}

async function resolveDoodstreamUrl(url, referer) {
  try {
    const embedUrl = url.replace(/\/d\//, "/e/");
    const { html } = await fetchHtmlWithHeaders(embedUrl, referer);

    const passMatch = html.match(/\/pass_md5\/[^'"\s]+/i);
    if (passMatch) {
      const passUrl = `https://${new URL(embedUrl).hostname}${passMatch[0]}`;
      const tokenResponse = await fetchHtmlWithHeaders(passUrl, embedUrl);
      const tokenUrl = tokenResponse.html.trim();

      if (tokenUrl && (tokenUrl.startsWith("http") || tokenUrl.startsWith("//"))) {
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        let randomStr = "";
        for (let i = 0; i < 10; i++) {
          randomStr += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return `${tokenUrl}${randomStr}?token=${passMatch[0].split("/").pop()}&expiry=${Date.now()}`;
      }
    }

    return findFirstUrl(html, [
      /(https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*)/i,
      /(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i,
      /"file"\s*:\s*"([^"]+)"/i,
      /source\s*src\s*=\s*["']([^"']+)["']/i,
    ]);
  } catch (err) {
    debugLog("Doodstream", "Error", err.message);
    return null;
  }
}

async function resolveDroploadUrl(url, referer) {
  try {
    const { html } = await fetchHtmlWithHeaders(url, referer);

    const extracted = findFirstUrl(html, [
      /(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i,
      /sources?\s*:\s*\[\s*\{[^}]*(?:file|src)\s*:\s*["'](https?:\/\/[^"']+)["']/i,
      /file\s*:\s*["'](https?:[^\s"']+)["']/i,
      /"file"\s*:\s*"([^"]+)"/i,
      /"source"\s*:\s*"([^"]+)"/i,
      /player\.config\s*=\s*\{[^}]*file\s*:\s*["']([^"']+)["']/i,
      /player\.setup\(\{[^}]*file\s*:\s*["']([^"']+)["']/i,
      /(https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*)/i,
    ]);

    if (extracted && !extracted.startsWith("blob:")) return extracted;

    const dataMatch = html.match(/data-src=["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i);
    if (dataMatch && dataMatch[1] && !dataMatch[1].startsWith("blob:")) {
      return normalizeExtractedUrl(dataMatch[1]);
    }
    return null;
  } catch (err) {
    debugLog("Dropload", "Error", err.message);
    return null;
  }
}

async function resolveEmbedUrl(url, parentUrl = null) {
  if (!url) return null;

  let parsed;
  try {
    parsed = new URL(url);
  } catch (_error) {
    return url;
  }

  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const pathname = parsed.pathname.toLowerCase();
  const referer = getRefererForUrl(parentUrl || url);

  if (/wish|awish|playnix|medix|niramirus|kravaxxa|davioad|haxlopp|tryzendm|dumbalag|dhcplay|hglink/i.test(host)) {
    const resolved = await extractStreamwish(url);
    if (resolved) return resolved;
  }

  if (/streamtape/i.test(host)) {
    const resolved = await extractStreamtape(url);
    if (resolved) return resolved;
  }

  if (/voe/i.test(host) || /\/e\//.test(pathname)) {
    const resolved = await extractVoe(url);
    if (resolved) return resolved;
  }

  if (/hqq\.tv|netu|waaw/i.test(host)) {
    const resolved = await resolveHqqUrl(url, referer);
    if (resolved) return resolved;
  }

  if (/vidhide/i.test(host)) {
    const resolved = await resolveVidhideUrl(url, referer);
    if (resolved) return resolved;
  }

  if (/mixdrop|mxdcontent/i.test(host)) {
    const resolved = await resolveMixdropUrl(url, referer);
    if (resolved) return resolved;
  }

  if (/dood|dstream|ds2play|doods/i.test(host)) {
    const resolved = await resolveDoodstreamUrl(url, referer);
    if (resolved) return resolved;
  }

  if (/dropload|dr0pstream|drop\.download/i.test(host)) {
    const resolved = await resolveDroploadUrl(url, referer);
    if (resolved) return resolved;
  }

  if (/mp4upload/i.test(host)) {
    if (!pathname.includes("embed") && !pathname.endsWith(".html")) {
      const slug = pathname.split("/").filter(Boolean).pop();
      if (slug) {
        url = `https://www.mp4upload.com/embed-${slug}.html`;
      }
    }
    const resolved = await resolveEmbedWithPuppeteer(url, referer);
    if (resolved) return resolved;
    return url;
  }

  if (ytdlpResolver.isAvailable) {
    const ytdlpResolved = await ytdlpResolver.extractWithYtdlp(url, referer);
    if (ytdlpResolved) return ytdlpResolved;
  }

  const isProtectedSite =
    /wish|playnix|medix|niramirus|kravaxxa|davioad|haxlopp|tryzendm|dumbalag|dhcplay|hglink|vidhide|voe|mixdrop|dood|dropload/i.test(host);
  if (isProtectedSite) {
    const resolved = await resolveEmbedWithPuppeteer(url, referer);
    if (resolved) return resolved;
  }

  const puppeteerResolved = await resolveEmbedWithPuppeteer(url, referer);
  if (puppeteerResolved) return puppeteerResolved;

  return url;
}

module.exports = {
  resolveEmbedUrl,
};
