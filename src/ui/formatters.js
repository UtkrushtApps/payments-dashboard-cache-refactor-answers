// src/ui/formatters.js

/**
 * Format a date string (YYYY-MM-DD) into a more readable form.
 */
export function formatDate(dateStr) {
  if (!dateStr) return '';

  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;

  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format a number as currency, defaulting to USD.
 */
export function formatCurrency(amount, currency = 'USD') {
  if (amount == null || Number.isNaN(Number(amount))) {
    return '-';
  }

  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch (_) {
    // Fallback if Intl or currency is not supported
    const fixed = Number(amount).toFixed(2);
    return `${currency} ${fixed}`;
  }
}

/**
 * Format an integer count with grouping.
 */
export function formatCount(count) {
  if (count == null || Number.isNaN(Number(count))) {
    return '-';
  }

  try {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(count);
  } catch (_) {
    return String(count);
  }
}
