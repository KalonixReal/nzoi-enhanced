/**
 * Runs at document_start — removes any <meta http-equiv="Content-Security-Policy">
 * tags before they are processed. Also observes for dynamically added ones.
 */
(function() {
  function removeCspMeta() {
    document.querySelectorAll(
      'meta[http-equiv="Content-Security-Policy"], meta[http-equiv="content-security-policy"]'
    ).forEach(m => m.remove());
  }

  // document.documentElement may be null at the very start on some pages;
  // guard before calling observe.
  function tryObserve() {
    const root = document.documentElement;
    if (!root) return;
    removeCspMeta();
    const obs = new MutationObserver(removeCspMeta);
    obs.observe(root, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', () => obs.disconnect(), { once: true });
  }

  if (document.documentElement) {
    tryObserve();
  } else {
    // Extremely early — wait one microtask tick
    Promise.resolve().then(tryObserve);
  }
})();
