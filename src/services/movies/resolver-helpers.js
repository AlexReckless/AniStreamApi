const axios = require("axios");
const cheerio = require("cheerio");
const http = require("node:http");
const https = require("node:https");

const UA_FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";

const axiosInstance = axios.create({
  timeout: 10000,
  headers: { "User-Agent": UA_FIREFOX },
  httpAgent: new http.Agent({ keepAlive: true }),
  httpsAgent: new https.Agent({ keepAlive: true }),
});

async function axiosGet(url, opts = {}) {
  return axiosInstance.get(url, {
    responseType: "text",
    ...opts,
  });
}

module.exports = {
  axiosGet,
  cheerio,
  UA_FIREFOX,
};
