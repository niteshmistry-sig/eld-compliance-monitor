/**
 * fleetView.js — Fleet overview table with color-coded urgency cells.
 * Depends on: HosUtils
 */
var FleetView = (function () {
  'use strict';

  var currentData = [];
  var filteredData = [];
  var sortField = 'name';
  var sortDir = 'asc';
  var onRowClick = null;

  /**
   * Initialize the fleet view.
   * @param {object} opts
   *   opts.onRowClick — function(driverData) called when a row is clicked
   */
  function init(opts) {
    onRowClick = opts.onRowClick || null;
    bindSortHeaders();
    bindSearch();
  }

  function bindSortHeaders() {
    var headers = document.querySelectorAll('#ecmFleetTable thead th[data-sort]');
    headers.forEach(function (th) {
      th.addEventListener('click', function () {
        var field = th.getAttribute('data-sort');
        if (sortField === field) {
          sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          sortField = field;
          sortDir = 'asc';
        }
        updateSortArrows();
        sortAndRender();
      });
    });
  }

  function bindSearch() {
    var searchInput = document.getElementById('ecmSearch');
    searchInput.addEventListener('input', function () {
      filterData(searchInput.value);
    });
  }

  /**
   * Render the fleet table with new data.
   * @param {Array} data — array of driver HOS objects from HosDataService
   */
  function render(data) {
    currentData = data || [];
    var searchVal = document.getElementById('ecmSearch').value;
    filterData(searchVal);
    updateSummary();
  }

  function filterData(query) {
    if (!query || !query.trim()) {
      filteredData = currentData.slice();
    } else {
      var q = query.toLowerCase().trim();
      filteredData = currentData.filter(function (d) {
        return d.name.toLowerCase().indexOf(q) >= 0;
      });
    }
    sortAndRender();
  }

  function sortAndRender() {
    filteredData.sort(function (a, b) {
      var va, vb;
      switch (sortField) {
        case 'name':
          va = a.name || '';
          vb = b.name || '';
          return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        case 'status':
          va = HosUtils.getStatusLabel(a.status) || '';
          vb = HosUtils.getStatusLabel(b.status) || '';
          return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        case 'drive':
          va = a.drive || 0;
          vb = b.drive || 0;
          return sortDir === 'asc' ? va - vb : vb - va;
        case 'duty':
          va = a.duty || 0;
          vb = b.duty || 0;
          return sortDir === 'asc' ? va - vb : vb - va;
        case 'break':
          va = a.break_ || 0;
          vb = b.break_ || 0;
          return sortDir === 'asc' ? va - vb : vb - va;
        case 'cycle':
          va = a.cycle || 0;
          vb = b.cycle || 0;
          return sortDir === 'asc' ? va - vb : vb - va;
        case 'violations':
          va = (a.violations || []).length;
          vb = (b.violations || []).length;
          return sortDir === 'asc' ? va - vb : vb - va;
        default:
          return 0;
      }
    });

    renderRows();
  }

  function renderRows() {
    var tbody = document.getElementById('ecmFleetBody');
    var emptyState = document.getElementById('ecmEmptyState');

    if (filteredData.length === 0) {
      tbody.innerHTML = '';
      emptyState.classList.remove('ecm-hidden');
      emptyState.textContent = currentData.length === 0
        ? 'No driver data available. Loading...'
        : 'No drivers match your search.';
      return;
    }

    emptyState.classList.add('ecm-hidden');

    var html = '';
    filteredData.forEach(function (d) {
      var statusLabel = HosUtils.getStatusLabel(d.status);
      var statusClass = HosUtils.getStatusClass(d.status);
      var driveUrgency = HosUtils.getUrgency('drive', d.drive);
      var dutyUrgency = HosUtils.getUrgency('duty', d.duty);
      var breakUrgency = HosUtils.getUrgency('break', d.break_);
      var cycleUrgency = HosUtils.getUrgency('cycle', d.cycle);
      var violCount = (d.violations || []).length;
      var violClass = violCount > 0 ? 'has-violations' : 'no-violations';

      html += '<tr data-driver-id="' + escapeAttr(d.driverId) + '">';
      html += '<td>' + escapeHtml(d.name) + '</td>';
      html += '<td><span class="ecm-status-badge ' + statusClass + '">' + escapeHtml(statusLabel) + '</span></td>';
      html += '<td><span class="ecm-time-cell ' + driveUrgency + '">' + HosUtils.formatCompact(d.drive) + '</span></td>';
      html += '<td><span class="ecm-time-cell ' + dutyUrgency + '">' + HosUtils.formatCompact(d.duty) + '</span></td>';
      html += '<td><span class="ecm-time-cell ' + breakUrgency + '">' + HosUtils.formatCompact(d.break_) + '</span></td>';
      html += '<td><span class="ecm-time-cell ' + cycleUrgency + '">' + HosUtils.formatCompact(d.cycle) + '</span></td>';
      html += '<td><span class="ecm-viol-count ' + violClass + '">' + violCount + '</span></td>';
      html += '</tr>';
    });

    tbody.innerHTML = html;

    // Bind row click events
    var rows = tbody.querySelectorAll('tr');
    rows.forEach(function (row) {
      row.addEventListener('click', function () {
        var driverId = row.getAttribute('data-driver-id');
        var driverData = currentData.find(function (d) { return d.driverId === driverId; });
        if (driverData && onRowClick) {
          // Highlight selected row
          rows.forEach(function (r) { r.classList.remove('ecm-row-selected'); });
          row.classList.add('ecm-row-selected');
          onRowClick(driverData);
        }
      });
    });
  }

  function updateSortArrows() {
    var arrows = document.querySelectorAll('#ecmFleetTable .sort-arrow');
    arrows.forEach(function (el) {
      el.className = 'sort-arrow';
    });

    var map = {
      'name': 'ecmSortName',
      'status': 'ecmSortStatus',
      'drive': 'ecmSortDrive',
      'duty': 'ecmSortDuty',
      'break': 'ecmSortBreak',
      'cycle': 'ecmSortCycle',
      'violations': 'ecmSortViolations'
    };

    var arrowEl = document.getElementById(map[sortField]);
    if (arrowEl) {
      arrowEl.className = 'sort-arrow ' + sortDir;
    }
  }

  function updateSummary() {
    var countEl = document.getElementById('ecmDriverCount');
    countEl.textContent = currentData.length + ' driver' + (currentData.length !== 1 ? 's' : '');

    var totalViolations = 0;
    currentData.forEach(function (d) {
      totalViolations += (d.violations || []).length;
    });

    var badge = document.getElementById('ecmViolationsSummary');
    badge.textContent = totalViolations + ' Violation' + (totalViolations !== 1 ? 's' : '');
    if (totalViolations > 0) {
      badge.classList.remove('none');
    } else {
      badge.classList.add('none');
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(str) {
    return escapeHtml(str);
  }

  return {
    init: init,
    render: render
  };
})();
