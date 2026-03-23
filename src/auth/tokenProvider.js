// src/auth/tokenProvider.js

import { logger } from '../utils/logger.js';

const TOKEN_KEY = 'authToken';

/**
 * Provides a single, consistent way to read the JWT token.
 *
 * - Prefers sessionStorage
 * - Falls back to localStorage
 * - If found only in localStorage, migrates it to sessionStorage
 */
export class TokenProvider {
  constructor(win = typeof window !== 'undefined' ? window : null) {
    this._window = win;
  }

  /**
   * Returns the JWT token string or null if not available.
   */
  getToken() {
    if (!this._window) {
      logger.warn('TokenProvider: window is not available');
      return null;
    }

    const { sessionStorage, localStorage } = this._window;

    let token = null;

    try {
      token = sessionStorage.getItem(TOKEN_KEY);
    } catch (err) {
      logger.warn('TokenProvider: failed to read from sessionStorage', null, err);
    }

    if (token) {
      return token;
    }

    try {
      token = localStorage.getItem(TOKEN_KEY);
    } catch (err) {
      logger.warn('TokenProvider: failed to read from localStorage', null, err);
    }

    if (!token) {
      return null;
    }

    // Migrate token from localStorage to sessionStorage for consistency
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
      localStorage.removeItem(TOKEN_KEY);
      logger.info('TokenProvider: migrated token from localStorage to sessionStorage');
    } catch (err) {
      // Not fatal; fall back to using token directly
      logger.warn('TokenProvider: failed to migrate token to sessionStorage', null, err);
    }

    return token;
  }
}
