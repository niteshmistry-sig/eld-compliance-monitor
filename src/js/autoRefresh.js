/**
 * autoRefresh.js — Polling timer with countdown display, pause-on-blur, resume-on-focus.
 * No dependencies on other modules.
 */
var AutoRefresh = (function () {
  'use strict';

  var intervalSeconds = 300;  // default 5 min
  var remainingSeconds = 0;
  var tickTimer = null;
  var paused = false;
  var onRefresh = null;
  var countdownEl = null;

  /**
   * Initialize auto-refresh.
   * @param {object} opts
   *   opts.onRefresh — function() to call when timer fires
   *   opts.countdownId — DOM element ID for countdown display
   *   opts.selectId — DOM element ID for interval <select>
   */
  function init(opts) {
    onRefresh = opts.onRefresh || null;
    countdownEl = document.getElementById(opts.countdownId);

    var selectEl = document.getElementById(opts.selectId);
    if (selectEl) {
      intervalSeconds = parseInt(selectEl.value, 10) || 300;
      selectEl.addEventListener('change', function () {
        intervalSeconds = parseInt(selectEl.value, 10) || 300;
        reset();
      });
    }

    // Pause on window blur, resume on focus
    window.addEventListener('blur', function () {
      paused = true;
      updateDisplay();
    });

    window.addEventListener('focus', function () {
      if (paused) {
        paused = false;
        // If timer was at 0 while paused, trigger refresh now
        if (remainingSeconds <= 0 && onRefresh) {
          onRefresh();
        }
        updateDisplay();
      }
    });
  }

  /**
   * Start (or restart) the countdown.
   */
  function start() {
    remainingSeconds = intervalSeconds;
    paused = false;

    if (tickTimer) clearInterval(tickTimer);

    tickTimer = setInterval(function () {
      if (paused) return;

      remainingSeconds--;
      updateDisplay();

      if (remainingSeconds <= 0) {
        remainingSeconds = intervalSeconds;
        if (onRefresh) onRefresh();
      }
    }, 1000);

    updateDisplay();
  }

  /**
   * Reset the countdown to the current interval.
   */
  function reset() {
    remainingSeconds = intervalSeconds;
    updateDisplay();
  }

  /**
   * Stop the timer entirely.
   */
  function stop() {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    remainingSeconds = 0;
    updateDisplay();
  }

  function updateDisplay() {
    if (!countdownEl) return;

    if (paused) {
      countdownEl.textContent = 'paused';
      return;
    }

    var m = Math.floor(remainingSeconds / 60);
    var s = remainingSeconds % 60;
    countdownEl.textContent = m + ':' + (s < 10 ? '0' : '') + s;
  }

  return {
    init: init,
    start: start,
    reset: reset,
    stop: stop
  };
})();
