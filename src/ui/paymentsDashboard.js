// src/ui/paymentsDashboard.js

import { PaymentsService } from '../api/paymentsService.js';
import { HttpClient } from '../api/httpClient.js';
import { TokenProvider } from '../auth/tokenProvider.js';
import { PaymentsCache } from '../cache/paymentsCache.js';
import { logger } from '../utils/logger.js';
import { formatCurrency, formatCount, formatDate } from './formatters.js';

/**
 * Orchestrates UI interactions for the payments dashboard.
 * - Handles date range selection
 * - Loads data via PaymentsService
 * - Renders daily/monthly summaries
 * - Shows loading and error states without blanking existing data
 */

// Simple debounce helper to avoid hammering the backend when users adjust dates rapidly
function debounce(fn, delayMs) {
  let timeoutId = null;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delayMs);
  };
}

export function initPaymentsDashboard() {
  const elements = {
    startInput: document.getElementById('date-start'),
    endInput: document.getElementById('date-end'),
    refreshButton: document.getElementById('refresh-button'),
    dailyContainer: document.getElementById('daily-summary'),
    monthlyContainer: document.getElementById('monthly-summary'),
    statusMessage: document.getElementById('status-message'),
    loadingIndicator: document.getElementById('loading-indicator'),
  };

  // Basic existence check to avoid cryptic errors if HTML is missing
  if (!elements.startInput || !elements.endInput || !elements.dailyContainer || !elements.monthlyContainer) {
    logger.error('PaymentsDashboard: required DOM elements are missing');
    return;
  }

  const tokenProvider = new TokenProvider();
  const httpClient = new HttpClient({ baseUrl: '', timeoutMs: 10_000, tokenProvider });
  const cache = new PaymentsCache({ ttlMs: 5 * 60 * 1000 }); // 5 minutes TTL
  const service = new PaymentsService({ httpClient, cache });

  let currentRange = getInitialRange(elements.startInput, elements.endInput);
  let lastRequestId = 0;

  const debouncedReload = debounce(() => {
    const range = readRangeFromInputs(elements.startInput, elements.endInput);
    if (!range) {
      showStatus(elements.statusMessage, 'error', 'Please provide a valid start and end date.');
      return;
    }
    currentRange = range;
    void loadAndRender(range);
  }, 300);

  if (elements.refreshButton) {
    elements.refreshButton.addEventListener('click', () => debouncedReload());
  }

  elements.startInput.addEventListener('change', () => debouncedReload());
  elements.endInput.addEventListener('change', () => debouncedReload());

  // Initial load
  if (currentRange) {
    void loadAndRender(currentRange);
  }

  async function loadAndRender(range) {
    const requestId = ++lastRequestId;

    setLoading(elements.loadingIndicator, true);
    showStatus(elements.statusMessage, 'info', `Loading payments from ${formatDate(range.startDate)} to ${formatDate(range.endDate)}...`);

    let result;
    try {
      result = await service.getSummary(range);
    } catch (err) {
      // This should not normally happen because PaymentsService swallows errors,
      // but we guard anyway.
      logger.error('PaymentsDashboard: unexpected error from PaymentsService', null, err);
      if (requestId !== lastRequestId) {
        return; // out-of-date response
      }
      setLoading(elements.loadingIndicator, false);
      showStatus(elements.statusMessage, 'error', 'Unexpected error while loading payments. Please try again.');
      return;
    }

    if (requestId !== lastRequestId) {
      // A newer request has been issued; ignore this result to avoid flicker
      logger.debug('PaymentsDashboard: ignoring out-of-date response', { range });
      return;
    }

    const { daily, monthly } = result;

    setLoading(elements.loadingIndicator, false);

    const messages = [];
    let hasError = false;

    if (daily.data) {
      renderDailySummary(elements.dailyContainer, daily.data, daily.isStale, range);
      if (daily.isStale) {
        messages.push('Daily data may be out of date (showing last known values).');
      }
    } else if (daily.error) {
      hasError = true;
      messages.push('Unable to load daily payments.');
    }

    if (monthly.data) {
      renderMonthlySummary(elements.monthlyContainer, monthly.data, monthly.isStale, range);
      if (monthly.isStale) {
        messages.push('Monthly data may be out of date (showing last known values).');
      }
    } else if (monthly.error) {
      hasError = true;
      messages.push('Unable to load monthly payments.');
    }

    if (!daily.data && !monthly.data) {
      // No data at all for this range
      messages.unshift('No cached data is available for this date range.');
    }

    if (messages.length > 0) {
      const type = hasError ? 'error' : 'info';
      showStatus(elements.statusMessage, type, messages.join(' '));
    } else {
      clearStatus(elements.statusMessage);
    }
  }
}

function getInitialRange(startInput, endInput) {
  const existing = readRangeFromInputs(startInput, endInput);
  if (existing) return existing;

  // Default to last 7 days
  const end = new Date();
  const start = new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000);

  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);

  startInput.value = startDate;
  endInput.value = endDate;

  return { startDate, endDate };
}

function readRangeFromInputs(startInput, endInput) {
  const startDate = startInput.value;
  const endDate = endInput.value;

  if (!startDate || !endDate) return null;

  if (endDate < startDate) {
    return null;
  }

  return { startDate, endDate };
}

function setLoading(loadingElement, isLoading) {
  if (!loadingElement) return;

  if (isLoading) {
    loadingElement.removeAttribute('hidden');
    loadingElement.dataset.loading = 'true';
  } else {
    loadingElement.setAttribute('hidden', 'hidden');
    delete loadingElement.dataset.loading;
  }
}

function clearStatus(statusElement) {
  if (!statusElement) return;
  statusElement.textContent = '';
  statusElement.classList.remove('status--error', 'status--info');
}

function showStatus(statusElement, type, message) {
  if (!statusElement) return;

  statusElement.textContent = message;
  statusElement.classList.remove('status--error', 'status--info');

  if (type === 'error') {
    statusElement.classList.add('status--error');
  } else {
    statusElement.classList.add('status--info');
  }
}

function renderDailySummary(container, data, isStale, range) {
  if (!container) return;

  const frag = document.createDocumentFragment();

  const title = document.createElement('h3');
  title.textContent = 'Daily summary';
  frag.appendChild(title);

  const subtitle = document.createElement('p');
  subtitle.textContent = `From ${formatDate(range.startDate)} to ${formatDate(range.endDate)}`;
  subtitle.className = 'summary-date-range';
  frag.appendChild(subtitle);

  const list = document.createElement('dl');
  list.className = 'summary-list';

  appendSummaryItem(list, 'Total payments', formatCount(data.totalPayments ?? data.count));
  appendSummaryItem(list, 'Total revenue', formatCurrency(data.totalRevenue ?? data.totalAmount, data.currency || 'USD'));
  appendSummaryItem(list, 'Total refunds', formatCurrency(data.totalRefunds ?? data.refunds, data.currency || 'USD'));
  appendSummaryItem(list, 'Total payouts', formatCurrency(data.totalPayouts ?? data.payouts, data.currency || 'USD'));

  frag.appendChild(list);

  if (isStale) {
    const note = document.createElement('p');
    note.className = 'summary-stale-note';
    note.textContent = 'Showing last known daily data due to connectivity issues.';
    frag.appendChild(note);
  }

  container.replaceChildren(frag);
}

function renderMonthlySummary(container, data, isStale, range) {
  if (!container) return;

  const frag = document.createDocumentFragment();

  const title = document.createElement('h3');
  title.textContent = 'Monthly summary';
  frag.appendChild(title);

  const subtitle = document.createElement('p');
  subtitle.textContent = `From ${formatDate(range.startDate)} to ${formatDate(range.endDate)}`;
  subtitle.className = 'summary-date-range';
  frag.appendChild(subtitle);

  const list = document.createElement('dl');
  list.className = 'summary-list';

  appendSummaryItem(list, 'Monthly revenue', formatCurrency(data.totalRevenue ?? data.totalAmount, data.currency || 'USD'));
  appendSummaryItem(list, 'Monthly refunds', formatCurrency(data.totalRefunds ?? data.refunds, data.currency || 'USD'));
  appendSummaryItem(list, 'Monthly payouts', formatCurrency(data.totalPayouts ?? data.payouts, data.currency || 'USD'));

  if (typeof data.activeMerchants === 'number') {
    appendSummaryItem(list, 'Active merchants', formatCount(data.activeMerchants));
  }

  frag.appendChild(list);

  if (isStale) {
    const note = document.createElement('p');
    note.className = 'summary-stale-note';
    note.textContent = 'Showing last known monthly data due to connectivity issues.';
    frag.appendChild(note);
  }

  container.replaceChildren(frag);
}

function appendSummaryItem(list, labelText, valueText) {
  const dt = document.createElement('dt');
  dt.textContent = labelText;

  const dd = document.createElement('dd');
  dd.textContent = valueText;

  list.appendChild(dt);
  list.appendChild(dd);
}
