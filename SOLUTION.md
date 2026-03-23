# Solution Steps

1. Create a lightweight logging utility to centralize observability.
- Add src/utils/logger.js exporting a logger with debug/info/warn/error methods.
- Prefix every log with a consistent tag and timestamp so network/cache behavior can be traced.
- Use console[level] with a fallback to console.log so it works across browsers.

2. Implement a TokenProvider to unify authentication handling.
- Add src/auth/tokenProvider.js with a TokenProvider class.
- In getToken(), first try reading the JWT from sessionStorage under a single key (e.g., authToken).
- If not present, look in localStorage; if found there, migrate it into sessionStorage and remove it from localStorage.
- Wrap storage access in try/catch and log any failures via the logger so missing/blocked storage doesn’t crash the app.
- Always return the token string or null; do not throw errors from this layer.

3. Introduce a two-layer payments cache with TTL.
- Add src/cache/paymentsCache.js implementing a PaymentsCache class.
- Use an in-memory Map as the primary cache, keyed by `${prefix}:${metricType}:${start}:${end}`.
- Back it with localStorage so data survives page reloads for a short period.
- Store entries as { data, timestamp } and configure a TTL (e.g., 5 minutes) passed via constructor.
- Implement get(metric, start, end, { allowStale }) that:
  - Checks the in-memory Map first; if not present, reads from localStorage and promotes the entry into memory.
  - Evaluates expiry by comparing Date.now() with the stored timestamp.
  - Returns null when the entry is expired and allowStale is false; otherwise returns { data, timestamp, isStale }.
- Implement set(metric, start, end, data) to update both Map and localStorage, handling JSON/string conversion and catching storage errors.
- Add clearAll() to wipe all cache entries for this prefix from both layers.

4. Wrap fetch in a robust HttpClient that handles auth, JSON, and timeouts.
- Add src/api/httpClient.js with an HttpClient class and an HttpError error type.
- In the constructor, accept baseUrl, timeoutMs, and a TokenProvider instance.
- Build URLs with a helper that concatenates baseUrl and path and appends query params via URLSearchParams.
- Build default headers with Accept: application/json and optional Authorization: Bearer <token> from the TokenProvider.
- Implement a private _request(url, options) that:
  - Uses AbortController and setTimeout to enforce a request timeout.
  - Calls fetch and determines whether to parse JSON or text based on the Content-Type header.
  - Throws HttpError for non-2xx responses, capturing status and parsed body and logging warnings.
  - Catches AbortError and other network errors, logs them, and rethrows as HttpError with status 0.
- Expose a public get(path, { query }) method that builds the URL and delegates to _request with method: 'GET'.

5. Create a PaymentsService to orchestrate API calls and caching.
- Add src/api/paymentsService.js exporting a PaymentsService class.
- Inject HttpClient and PaymentsCache through the constructor.
- Implement getSummary({ startDate, endDate }) to fetch both metrics concurrently:
  - Call a private _loadMetric('daily', '/api/payments/daily', { startDate, endDate }).
  - Call a private _loadMetric('monthly', '/api/payments/monthly', { startDate, endDate }).
  - Return an object { daily, monthly } where each is a MetricResult.
- In _loadMetric(metricType, path, { startDate, endDate }):
  - Look up a fresh cache entry with cache.get(metricType, start, end, { allowStale: false }). If found, log a cache hit and return { data, isStale: false, fromCache: true, error: null }.
  - Also prefetch any stale entry via cache.get(metricType, start, end, { allowStale: true }) to use as a fallback if the network fails.
  - Attempt an HTTP GET to the corresponding endpoint with query { start: startDate, end: endDate }.
  - On success, write the response data into the cache via cache.set and return { data, isStale: false, fromCache: false, error: null }.
  - On failure, if a stale cache entry exists, return it as { data: stale.data, isStale: true, fromCache: true, error: err }; otherwise return { data: null, isStale: false, fromCache: false, error: err }.
- Ensure _loadMetric never throws, so that UI code always receives a well-structured result object.

6. Add simple formatting helpers for dates, currency, and counts.
- Create src/ui/formatters.js with functions:
  - formatDate(yyyyMmDd) -> localized readable date using Date and toLocaleDateString; fall back to the raw string on parse failure.
  - formatCurrency(amount, currency='USD') -> use Intl.NumberFormat with style 'currency', falling back to a simple `${currency} ${amount.toFixed(2)}` if Intl or the currency is unsupported.
  - formatCount(count) -> use Intl.NumberFormat for grouped integers, falling back to String(count) on failure.
- These helpers keep DOM code free from low-level formatting logic and make it easier to adjust display rules later.

7. Implement the payments dashboard controller and renderer.
- Add src/ui/paymentsDashboard.js and export initPaymentsDashboard().
- On init, cache references to required DOM nodes: start date input (#date-start), end date input (#date-end), refresh button (#refresh-button), daily and monthly containers (#daily-summary, #monthly-summary), status message (#status-message), and an optional loading indicator (#loading-indicator).
- Construct the core services:
  - TokenProvider for consistent JWT retrieval.
  - HttpClient configured with a base URL (empty for relative /api paths) and timeout.
  - PaymentsCache with a 5-minute TTL.
  - PaymentsService composed from HttpClient and PaymentsCache.
- Establish the initial date range:
  - Try to read from the inputs; if invalid or empty, default to the last 7 days and write those values back into the inputs.
- Implement readRangeFromInputs() that validates both dates are set and endDate >= startDate, returning { startDate, endDate } or null.
- Wire up interactions:
  - Add change listeners to both date inputs and a click listener to the refresh button.
  - Wrap the reload function in a small debounce (e.g., 300ms) to avoid excessive network requests when users are adjusting dates.
- Maintain a monotonically increasing requestId in the closure; each loadAndRender(range) call increments it and captures its own id so that responses for older requests can be detected and ignored (preventing flicker when users change ranges quickly).

8. Make the data-loading flow resilient and cache-aware in the dashboard controller.
- Implement loadAndRender(range) in src/ui/paymentsDashboard.js:
  - Increment lastRequestId and capture it as requestId for this invocation.
  - Show a loading state by toggling a hidden attribute or data-loading flag on the loading indicator.
  - Set a status message indicating that data is being loaded for the selected date range.
  - Await service.getSummary(range) inside a try/catch; log and surface a generic error if something unexpected bubbles up.
  - On resolution, immediately verify that requestId still matches lastRequestId; if not, discard the result (a newer request superseded it).
  - Extract daily and monthly MetricResults and stop loading state.
  - For each metric:
    - If data exists, call a dedicated render function to update only that section of the DOM.
    - If data is marked isStale, append an informational message noting data may be out of date.
    - If data is null but error is set, accumulate user-friendly error texts like "Unable to load daily payments." without clearing previously-rendered content.
  - If neither metric has data, prepend a message explaining that no cached data is available for this date range.
  - Use a helper showStatus(element, type, message) to render the assembled messages with type-specific CSS classes (e.g., status--error vs status--info).
  - Never clear daily/monthly containers when a metric fails with no fallback; this preserves the last successful view and avoids blank screens.

9. Improve DOM rendering for smooth, flicker-free updates.
- In src/ui/paymentsDashboard.js, implement setLoading(), clearStatus(), and showStatus() so the UI communicates loading and errors without aggressively reflowing the page.
- Implement renderDailySummary(container, data, isStale, range):
  - Create a DocumentFragment to batch DOM updates.
  - Add a heading (e.g., "Daily summary") and a subtitle showing the formatted date range.
  - Build a definition list (<dl>) with key metrics (total payments, total revenue, refunds, payouts) using formatCount and formatCurrency.
  - If isStale is true, append a small note indicating that the data is from a previous load due to connectivity issues.
  - Replace the container’s children using container.replaceChildren(frag) to avoid using innerHTML and to minimize layout thrash.
- Implement renderMonthlySummary(container, data, isStale, range) similarly but with monthly-specific labels and any additional metrics (e.g., active merchants).
- Add a helper appendSummaryItem(list, label, value) that appends <dt> and <dd> pairs to the <dl>, again avoiding innerHTML.
- This structure keeps updates localized to the daily and monthly sections, reduces flicker, and remains resilient when some metrics fail while others succeed.

10. Wire up the entry point to initialize the dashboard on DOM ready.
- Add src/index.js that imports initPaymentsDashboard from ./ui/paymentsDashboard.js.
- Call initPaymentsDashboard() either immediately if document.readyState is already 'complete'/'interactive', or inside a DOMContentLoaded listener if the DOM is still loading.
- This isolates bootstrapping from the rest of the logic and makes it clear where the dashboard lifecycle starts.

11. Review and harden error handling and observability across the module.
- Ensure every interaction with storage (sessionStorage/localStorage) is wrapped in try/catch and logs via logger.warn instead of throwing.
- Make sure HttpClient always throws HttpError for API and network problems so higher layers have a consistent error shape.
- Confirm PaymentsService never throws to the UI; it always returns MetricResult objects with error fields populated when failures occur.
- Verify the dashboard controller never calls innerHTML for rendering; it should rely on DOM APIs like textContent, createElement, and replaceChildren.
- Confirm that on any error path, the UI keeps existing metric displays intact and only updates status and loading indicators, satisfying the requirement to avoid blank or partially updated screens.

