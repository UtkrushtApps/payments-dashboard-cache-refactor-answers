// src/index.js

import { initPaymentsDashboard } from './ui/paymentsDashboard.js';

// Bootstrap the payments dashboard once the DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initPaymentsDashboard();
  });
} else {
  initPaymentsDashboard();
}
