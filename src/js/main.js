/**
 * main.js — Add-in entry point and lifecycle hooks.
 * MyGeotab calls the global `geotab.addin.eldComplianceMonitor` hooks.
 * Depends on: HosUtils, DriverCache, HosDataService, FleetView, DetailView, AutoRefresh
 */
(function () {
  'use strict';

  var state = {
    api: null,
    page: null,
    hosData: [],
    loading: false
  };

  // ---- Lifecycle hooks expected by MyGeotab ----

  if (!window.geotab) window.geotab = {};
  if (!window.geotab.addin) window.geotab.addin = {};

  window.geotab.addin.eldComplianceMonitor = {
    initialize: function (api, page, callback) {
      state.api = api;
      state.page = page;

      initUI();
      setStatus('<span class="ecm-spinner"></span>Loading drivers...');

      DriverCache.init(api)
        .then(function () {
          var count = DriverCache.count();
          setStatus('<span class="ecm-spinner"></span>Loaded ' + count + ' drivers. Fetching HOS data...');
          return refreshData();
        })
        .then(function () {
          setStatus('');
          callback();
        })
        .catch(function (err) {
          setStatus('Error loading data: ' + (err.message || err), true);
          callback();
        });
    },

    focus: function (api, page) {
      state.api = api;
      state.page = page;
      AutoRefresh.start();
    },

    blur: function () {
      AutoRefresh.stop();
    }
  };

  // ---- UI Initialization ----

  function initUI() {
    // Fleet view: handle row clicks by opening detail panel
    FleetView.init({
      onRowClick: function (driverData) {
        DetailView.open(driverData);
      }
    });

    // Detail view
    DetailView.init(state.api);

    // Auto-refresh
    AutoRefresh.init({
      onRefresh: function () {
        refreshData();
      },
      countdownId: 'ecmCountdown',
      selectId: 'ecmRefreshInterval'
    });

    // Manual refresh button
    document.getElementById('ecmRefreshBtn').addEventListener('click', function () {
      refreshData();
    });
  }

  // ---- Data Refresh ----

  function refreshData() {
    if (state.loading) return Promise.resolve();
    state.loading = true;

    var btn = document.getElementById('ecmRefreshBtn');
    btn.disabled = true;

    return HosDataService.fetchAll(state.api, function (msg) {
      setStatus('<span class="ecm-spinner"></span>' + msg);
    })
    .then(function (data) {
      state.hosData = data;
      state.loading = false;
      btn.disabled = false;

      FleetView.render(data);
      AutoRefresh.reset();
      AutoRefresh.start();
      setStatus('');
    })
    .catch(function (err) {
      state.loading = false;
      btn.disabled = false;
      setStatus('Refresh error: ' + (err.message || err), true);
      AutoRefresh.reset();
      AutoRefresh.start();
    });
  }

  // ---- Status Helpers ----

  function setStatus(msg, isError) {
    var el = document.getElementById('ecmStatus');
    if (!el) return;

    if (msg && msg.indexOf('<') >= 0) {
      el.innerHTML = msg;
    } else {
      el.textContent = msg || '';
    }
    el.className = 'ecm-status' + (isError ? ' error' : '');

    // Hide toolbar until data is loaded
    var toolbar = document.getElementById('ecmToolbar');
    if (toolbar) {
      toolbar.style.display = msg ? 'none' : '';
    }
  }

})();
