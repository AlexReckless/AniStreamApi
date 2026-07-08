// Motor de scraping original creado por FxxMorgan (https://github.com/FxxMorgan)
class ApiError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

module.exports = { ApiError };
