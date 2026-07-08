const { axiosGet } = require("../resolver-helpers");
const { unpack, detect } = require("unpacker");
const { URL } = require("node:url");

function best(master, base) {
  try {
    const lines = master.split("\n");
    let bestUrl = null;
    let bestScore = 0;

    for (let i = 0; i < lines.length; i++) {
      const m = /RESOLUTION=(\d+)x(\d+)/.exec(lines[i]);
      if (!m) continue;

      const next = lines[i + 1]?.trim();
      if (!next || next.startsWith("#")) continue;

      const score = m[1] * m[2];
      if (score > bestScore) {
        bestScore = score;
        bestUrl = new URL(next, base).href;
      }
    }
    return bestUrl;
  } catch (e) {
    return null;
  }
}

async function redir(pageUrl) {
  try {
    const dmca = ["playnixes.com", "niramirus.com", "medixiru.com", "hgplaycdn.com", "hglamioz.com"];
    const main = ["kravaxxa.com", "davioad.com", "haxloppd.com", "tryzendm.com", "dumbalag.com"];
    const rules = ["dhcplay.com", "hglink.to", "test.hglink.to", "wish-redirect.aiavh.com"];

    const url = new URL(pageUrl);
    const destination = rules.includes(url.hostname)
      ? main[Math.floor(Math.random() * main.length)]
      : dmca[Math.floor(Math.random() * dmca.length)];

    return "https://" + destination + url.pathname + url.search;
  } catch (error) {
    console.error("[SW RESOLVER] Error generando redirectUrl:", error.message);
    return pageUrl;
  }
}

async function extractStreamwish(pageUrl) {
  console.log(`[SW RESOLVER] Resolviendo: ${pageUrl}`);
  try {
    const finalUrl = await redir(pageUrl);

    let html;
    try {
      const res = await axiosGet(finalUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
          Accept: "*/*",
          Referer: finalUrl,
        },
      });
      html = res.data;
    } catch (e) {
      try {
        const res = await axiosGet(pageUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
            Accept: "*/*",
            Referer: pageUrl,
          },
        });
        html = res.data;
      } catch (errOriginal) {
        console.error("[SW RESOLVER] Error descargando pagina:", errOriginal.message);
        return null;
      }
    }

    const scriptMatch = html.match(
      /<script[^>]*type=['"]text\/javascript['"][^>]*>\s*(eval\(function\(p,a,c,k,e,d\)[\s\S]*?)<\/script>/i
    );
    if (!scriptMatch) return null;

    const packedJs = scriptMatch[1];
    if (!detect(packedJs)) return null;

    const unpacked = unpack(packedJs);
    const linksMatch = unpacked.match(/var\s+links\s*=\s*(\{[\s\S]*?\});/i);
    if (!linksMatch) return null;

    let links;
    try {
      links = JSON.parse(linksMatch[1]);
    } catch (e) {
      return null;
    }

    const link = links.hls4 || links.hls3 || links.hls1 || links.hls2;
    if (!link) return null;

    const masterUrl = link.startsWith("/") ? new URL(link, finalUrl).href : link;

    let playlist;
    try {
      const res = await axiosGet(masterUrl, {
        headers: { "User-Agent": "Mozilla/5.0", Accept: "*/*", Referer: finalUrl },
      });
      playlist = res.data;
    } catch (e) {
      return masterUrl;
    }

    const base = masterUrl.slice(0, masterUrl.lastIndexOf("/") + 1);
    return best(playlist, base) || masterUrl;
  } catch (err) {
    console.error("[SW RESOLVER] Error:", err.message);
    return null;
  }
}

module.exports = { extractStreamwish };
