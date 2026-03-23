// src/api/paymentsService.js

import { logger } from '../utils/logger.js';

/**
 * High-level payments data access layer.
 * Orchestrates HTTP calls and caching for daily and monthly metrics.
 */
export class PaymentsService {
  /**
   * @param {Object} deps
   * @param {HttpClient} deps.httpClient
   * @param {PaymentsCache} deps.cache
   */
  constructor({ httpClient, cache }) {
    this._httpClient = httpClient;
    this._cache = cache;
  }

  /**
   * Load both daily and monthly summaries for the given date range.
   *
   * @param {Object} range
   * @param {string} range.startDate - ISO date string (YYYY-MM-DD)
   * @param {string} range.endDate - ISO date string (YYYY-MM-DD)
   * @returns {Promise<{ daily: MetricResult, monthly: MetricResult }>}
   */
  async getSummary(range) {
    const { startDate, endDate } = range;

    const [daily, monthly] = await Promise.all([
      this._loadMetric('daily', '/api/payments/daily', { startDate, endDate }),
      this._loadMetric('monthly', '/api/payments/monthly', { startDate, endDate }),
    ]);

    return { daily, monthly };
  }

  /**
   * @typedef {Object} MetricResult
   * @property {any|null} data
   * @property {boolean} isStale - Whether the data is from an expired cache entry
   * @property {boolean} fromCache
   * @property {Error|null} error - Network or HTTP error, if any
   */

  /**
   * Load a single metric with caching and graceful fallback.
   * Never throws; instead returns a MetricResult with error filled in.
   */
  async _loadMetric(metricType, path, { startDate, endDate }) {
    const query = { start: startDate, end: endDate };

    // 1. Fresh cache lookup
    const freshEntry = this._cache.get(metricType, startDate, endDate, { allowStale: false });
    if (freshEntry) {
      logger.debug('PaymentsService: cache hit', { metricType, startDate, endDate, stale: false });
      return {
        data: freshEntry.data,
        isStale: false,
        fromCache: true,
        error: null,
      };
    }

    // 2. We may still want a stale entry as a last-resort fallback if network fails
    const staleEntry = this._cache.get(metricType, startDate, endDate, { allowStale: true });

    // 3. Fetch from network
    try {
      const data = await this._httpClient.get(path, { query });

      this._cache.set(metricType, startDate, endDate, data);

      logger.info('PaymentsService: fetched metric from API', { metricType, startDate, endDate });

      return {
        data,
        isStale: false,
        fromCache: false,
        error: null,
      };
    } catch (err) {
      logger.warn('PaymentsService: failed to fetch metric, falling back to cache if possible', {
        metricType,
        startDate,
        endDate,
      }, err);

      if (staleEntry) {
        return {
          data: staleEntry.data,
          isStale: true,
          fromCache: true,
          error: err,
        };
      }

      // No cache and network failed
      return {
        data: null,
        isStale: false,
        fromCache: false,
        error: err,
      };
    }
  }
}
