// src/utils/logger.js

export const LogLevel = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
};

function formatPrefix(level) {
  const timestamp = new Date().toISOString();
  return `[payments-dashboard][${timestamp}][${level.toUpperCase()}]`;
}

function log(level, message, context, error) {
  const prefix = formatPrefix(level);
  const parts = [prefix, message];

  if (context) {
    parts.push(context);
  }

  if (error) {
    parts.push(error);
  }

  const consoleFn = console[level] || console.log; // Fallback for older browsers
  consoleFn.apply(console, parts);
}

export const logger = {
  debug(message, context) {
    log(LogLevel.DEBUG, message, context);
  },

  info(message, context) {
    log(LogLevel.INFO, message, context);
  },

  warn(message, context) {
    log(LogLevel.WARN, message, context);
  },

  error(message, context, error) {
    log(LogLevel.ERROR, message, context, error);
  },
};
