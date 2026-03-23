// src/api/httpClient.js

import { logger } from '../utils/logger.js';

export class HttpError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Lightweight HTTP client wrapper around fetch.
 * - Adds Authorization header from TokenProvider
 * - Applies a request timeout
 * - Throws HttpError for non-2xx responses
 */
export class HttpClient {
  /**
   * @param {Object} options
   * @param {string} [options.baseUrl='']
   * @param {number} [options.timeoutMs=10000]
   * @param {TokenProvider} options.tokenProvider
   */
  constructor({ baseUrl = '', timeoutMs = 10000, tokenProvider }) {
    this._baseUrl = baseUrl.replace(/\/$/, ''); // trim trailing slash
    this._timeoutMs = timeoutMs;
    this._tokenProvider = tokenProvider;
  }

  _buildUrl(path, query) {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(this._baseUrl + normalizedPath, window.location.origin);

    if (query && typeof query === 'object') {
      Object.entries(query).forEach(([key, value]) => {
        if (value != null && value !== '') {
          url.searchParams.set(key, String(value));
        }
      });
    }

    return url.toString();
  }

  _buildHeaders() {
    const headers = new Headers();
    headers.set('Accept', 'application/json');

    const token = this._tokenProvider ? this._tokenProvider.getToken() : null;
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    return headers;
  }

  async _request(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this._timeoutMs);

    const finalOptions = {
      ...options,
      signal: controller.signal,
      headers: options.headers || this._buildHeaders(),
    };

    logger.debug('HttpClient: request', { url, method: finalOptions.method || 'GET' });

    try {
      const response = await fetch(url, finalOptions);
      clearTimeout(timeoutId);

      const contentType = response.headers.get('Content-Type') || '';
      const isJson = contentType.includes('application/json');
      const body = isJson ? await response.json().catch(() => null) : await response.text().catch(() => null);

      if (!response.ok) {
        logger.warn('HttpClient: non-2xx response', { url, status: response.status, body });
        throw new HttpError(`Request failed with status ${response.status}`, {
          status: response.status,
          body,
        });
      }

      return body;
    } catch (err) {
      clearTimeout(timeoutId);

      if (err.name === 'AbortError') {
        logger.warn('HttpClient: request aborted (timeout)', { url });
        throw new HttpError('Request timed out', { status: 0 });
      }

      if (err instanceof HttpError) {
        throw err;
      }

      logger.error('HttpClient: network error', { url }, err);
      throw new HttpError('Network error occurred', { status: 0 });
    }
  }

  /**
   * Perform a GET request.
   * @param {string} path
   * @param {Object} [options]
   * @param {Object} [options.query]
   */
  async get(path, { query } = {}) {
    const url = this._buildUrl(path, query);
    return this._request(url, { method: 'GET' });
  }
}
