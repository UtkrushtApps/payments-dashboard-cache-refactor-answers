// src/cache/paymentsCache.js

import { logger } from '../utils/logger.js';

/**
 * A two-layer cache for payment metrics:
 * - In-memory Map for fast, per-session access
 * - localStorage for short-lived persistence across reloads
 *
 * Each entry has a timestamp; TTL is enforced when reading.
 */
export class PaymentsCache {
  /**
   * @param {Object} options
   * @param {number} [options.ttlMs=300000] - Time-to-live in milliseconds (default 5 minutes)
   * @param {string} [options.keyPrefix='paymentsCache']
   * @param {Storage} [options.storage=window.localStorage]
   */
  constructor({
    ttlMs = 5 * 60 * 1000,
    keyPrefix = 'paymentsCache',
    storage = typeof window !== 'undefined' ? window.localStorage : null,
  } = {}) {
    this._ttlMs = ttlMs;
    this._keyPrefix = keyPrefix;
    this._storage = storage;
    this._memory = new Map();
  }

  _buildKey(metricType, startDate, endDate) {
    return `${this._keyPrefix}:${metricType}:${startDate}:${endDate}`;
  }

  _isExpired(timestamp, now) {
    return now - timestamp > this._ttlMs;
  }

  _readFromStorage(key) {
    if (!this._storage) return null;

    try {
      const raw = this._storage.getItem(key);
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;

      return parsed;
    } catch (err) {
      logger.warn('PaymentsCache: failed to read/parse from localStorage', { key }, err);
      return null;
    }
  }

  _writeToStorage(key, entry) {
    if (!this._storage) return;

    try {
      const raw = JSON.stringify(entry);
      this._storage.setItem(key, raw);
    } catch (err) {
      // If quota exceeded or storage disabled, we just log and continue with in-memory cache
      logger.warn('PaymentsCache: failed to write to localStorage', { key }, err);
    }
  }

  /**
   * Get a cache entry.
   *
   * @param {string} metricType - e.g. 'daily' or 'monthly'
   * @param {string} startDate - ISO date string
   * @param {string} endDate - ISO date string
   * @param {Object} [options]
   * @param {boolean} [options.allowStale=false] - If true, return stale entries as well
   * @returns {null | { data: any, timestamp: number, isStale: boolean }}
   */
  get(metricType, startDate, endDate, { allowStale = false } = {}) {
    const key = this._buildKey(metricType, startDate, endDate);
    const now = Date.now();

    // Check in-memory first
    const memEntry = this._memory.get(key);
    if (memEntry) {
      const isStale = this._isExpired(memEntry.timestamp, now);
      if (isStale && !allowStale) {
        return null;
      }
      return { data: memEntry.data, timestamp: memEntry.timestamp, isStale };
    }

    // Fallback to localStorage
    const storageEntry = this._readFromStorage(key);
    if (!storageEntry || typeof storageEntry.timestamp !== 'number') {
      return null;
    }

    const isStale = this._isExpired(storageEntry.timestamp, now);

    if (isStale && !allowStale) {
      return null;
    }

    // Promote to in-memory cache for faster subsequent access
    this._memory.set(key, { data: storageEntry.data, timestamp: storageEntry.timestamp });

    return { data: storageEntry.data, timestamp: storageEntry.timestamp, isStale };
  }

  /**
   * Store a cache entry.
   */
  set(metricType, startDate, endDate, data) {
    const key = this._buildKey(metricType, startDate, endDate);
    const entry = {
      data,
      timestamp: Date.now(),
    };

    this._memory.set(key, entry);
    this._writeToStorage(key, entry);
  }

  /**
   * Clear all cache entries for this prefix.
   */
  clearAll() {
    this._memory.clear();

    if (!this._storage) return;

    try {
      const prefix = `${this._keyPrefix}:`;
      for (let i = this._storage.length - 1; i >= 0; i -= 1) {
        const key = this._storage.key(i);
        if (key && key.startsWith(prefix)) {
          this._storage.removeItem(key);
        }
      }
    } catch (err) {
      logger.warn('PaymentsCache: failed to clear localStorage entries', null, err);
    }
  }
}
