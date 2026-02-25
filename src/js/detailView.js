/**
 * detailView.js — Driver detail slide-in panel with SVG arc gauges,
 * violations list, 7-day recap canvas chart, and status log timeline.
 * Depends on: HosUtils, HosDataService, DriverCache
 */
var DetailView = (function () {
  'use strict';

  var currentDriverId = null;
  var apiRef = null;

  /**
   * Initialize the detail view.
   * @param {object} api — MyGeotab api object
   */
  function init(api) {
    apiRef = api;
    document.getElementById('ecmDetailClose').addEventListener('click', close);
    document.getElementById('ecmDetailOverlay').addEventListener('click', close);
  }

  /**
   * Open the detail panel for a driver.
   * @param {object} driverData — from HosDataService (driverId, name, hosRuleSet, drive, duty, cycle, break_, status, violations, raw)
   */
  function open(driverData) {
    currentDriverId = driverData.driverId;

    // Set header info
    document.getElementById('ecmDetailName').textContent = driverData.name;
    document.getElementById('ecmDetailRuleset').textContent =
      DriverCache.getHosRuleLabel(driverData.hosRuleSet);

    var statusEl = document.getElementById('ecmDetailStatus');
    var statusLabel = HosUtils.getStatusLabel(driverData.status);
    statusEl.textContent = statusLabel;
    statusEl.className = 'ecm-status-badge ' + HosUtils.getStatusClass(driverData.status);

    // Render gauges
    renderGauge('ecmGaugeDrive', driverData.drive, 11, 'drive');
    document.getElementById('ecmGaugeDriveVal').textContent = HosUtils.formatHoursMinutes(driverData.drive);

    renderGauge('ecmGaugeDuty', driverData.duty, 14, 'duty');
    document.getElementById('ecmGaugeDutyVal').textContent = HosUtils.formatHoursMinutes(driverData.duty);

    renderGauge('ecmGaugeCycle', driverData.cycle, 70, 'cycle');
    document.getElementById('ecmGaugeCycleVal').textContent = HosUtils.formatHoursMinutes(driverData.cycle);

    renderGauge('ecmGaugeBreak', driverData.break_, 0.5, 'break');
    document.getElementById('ecmGaugeBreakVal').textContent = HosUtils.formatHoursMinutes(driverData.break_);

    // Render violations
    renderViolations(driverData.violations);

    // Show panel
    document.getElementById('ecmDetailOverlay').classList.add('open');
    document.getElementById('ecmDetailPanel').classList.add('open');

    // Fetch additional data (logs for recap and timeline)
    loadDetailData(driverData.driverId);
  }

  function close() {
    currentDriverId = null;
    document.getElementById('ecmDetailOverlay').classList.remove('open');
    document.getElementById('ecmDetailPanel').classList.remove('open');
  }

  /**
   * Render an SVG arc gauge.
   * @param {string} svgId — ID of the SVG element
   * @param {number} value — current hours remaining
   * @param {number} max — max hours for full gauge
   * @param {string} clockType — 'drive', 'duty', 'cycle', or 'break'
   */
  function renderGauge(svgId, value, max, clockType) {
    var svg = document.getElementById(svgId);
    if (!svg) return;

    var ratio = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;
    var urgency = HosUtils.getUrgency(clockType, value);

    var colors = {
      green:  '#2B6436',
      yellow: '#D4A017',
      red:    '#C51A11'
    };
    var color = colors[urgency] || colors.green;
    var bgColor = '#D9E1E8';

    // Arc parameters: semi-circle from 180° to 0° (left to right)
    var cx = 50;
    var cy = 60;
    var r = 40;
    var startAngle = Math.PI;     // 180° (left)
    var endAngle = 0;              // 0° (right)

    // Background arc (full semi-circle)
    var bgPath = describeArc(cx, cy, r, startAngle, endAngle);

    // Value arc
    var valueAngle = startAngle - (ratio * Math.PI);
    var valPath = describeArc(cx, cy, r, startAngle, valueAngle);

    svg.innerHTML =
      '<path d="' + bgPath + '" fill="none" stroke="' + bgColor + '" stroke-width="8" stroke-linecap="round"/>' +
      '<path d="' + valPath + '" fill="none" stroke="' + color + '" stroke-width="8" stroke-linecap="round"/>';
  }

  /**
   * Describe an SVG arc path from startAngle to endAngle (radians, standard math angles).
   */
  function describeArc(cx, cy, r, startAngle, endAngle) {
    var x1 = cx + r * Math.cos(startAngle);
    var y1 = cy - r * Math.sin(startAngle);
    var x2 = cx + r * Math.cos(endAngle);
    var y2 = cy - r * Math.sin(endAngle);

    var sweepAngle = startAngle - endAngle;
    var largeArc = sweepAngle > Math.PI ? 1 : 0;

    return 'M ' + x1.toFixed(2) + ' ' + y1.toFixed(2) +
           ' A ' + r + ' ' + r + ' 0 ' + largeArc + ' 1 ' +
           x2.toFixed(2) + ' ' + y2.toFixed(2);
  }

  /**
   * Render violations list.
   */
  function renderViolations(violations) {
    var container = document.getElementById('ecmDetailViolations');

    if (!violations || violations.length === 0) {
      container.innerHTML = '<div class="ecm-no-violations">No active violations</div>';
      return;
    }

    var html = '<ul class="ecm-violation-list">';
    violations.forEach(function (v) {
      var type = v.type || v.name || 'Violation';
      var time = HosUtils.formatDateTime(v.dateTime || v.fromDate);
      var duration = '';
      if (v.duration) {
        var hours = HosUtils.parseTimeSpanToHours(v.duration);
        duration = ' (' + HosUtils.formatHoursMinutes(hours) + ')';
      }

      html += '<li class="ecm-violation-item">';
      html += '<div>';
      html += '<div class="ecm-viol-type">' + escapeHtml(String(type).replace(/([A-Z])/g, ' $1').trim()) + '</div>';
      html += '<div class="ecm-viol-detail">' + escapeHtml(time) + escapeHtml(duration) + '</div>';
      html += '</div>';
      html += '</li>';
    });
    html += '</ul>';

    container.innerHTML = html;
  }

  /**
   * Load DutyStatusLog entries for recap chart and timeline.
   */
  function loadDetailData(driverId) {
    var logsContainer = document.getElementById('ecmDetailLogs');
    logsContainer.innerHTML = '<div class="ecm-detail-loading"><span class="ecm-spinner"></span> Loading logs...</div>';

    // Fetch recap logs (all logs for 7 days) and recent logs in parallel
    var recapPromise = HosDataService.fetchRecapLogs(apiRef, driverId);
    var recentPromise = HosDataService.fetchDutyStatusLogs(apiRef, driverId, 20);

    Promise.all([recapPromise, recentPromise])
      .then(function (results) {
        if (driverId !== currentDriverId) return; // User closed or switched

        var recapLogs = results[0];
        var recentLogs = results[1];

        renderRecapChart(recapLogs);
        renderStatusTimeline(recentLogs);
      })
      .catch(function (err) {
        if (driverId !== currentDriverId) return;
        logsContainer.innerHTML = '<div class="ecm-status error">Failed to load logs: ' +
          escapeHtml(err.message || String(err)) + '</div>';
        renderRecapChart([]);
      });
  }

  /**
   * Render 7-day recap bar chart on canvas.
   */
  function renderRecapChart(logs) {
    var canvas = document.getElementById('ecmRecapCanvas');
    if (!canvas) return;

    var ctx = canvas.getContext('2d');
    var rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width - 24;
    canvas.height = rect.height - 24;

    var w = canvas.width;
    var h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Aggregate hours per day for the last 7 days
    var days = [];
    var dayLabels = [];
    var now = new Date();
    for (var i = 6; i >= 0; i--) {
      var d = new Date(now);
      d.setDate(d.getDate() - i);
      var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      days.push({ key: key, hours: 0 });
      var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      dayLabels.push(dayNames[d.getDay()]);
    }

    // Sum on-duty / driving hours per day
    (logs || []).forEach(function (log) {
      if (!log.dateTime) return;
      var status = log.status || '';
      // Count driving and on-duty time
      if (status === 'D' || status === 'Driving' || status === 'ON' || status === 'OnDuty' || status === 'On') {
        var logDate = new Date(log.dateTime);
        var logKey = logDate.getFullYear() + '-' + String(logDate.getMonth() + 1).padStart(2, '0') + '-' + String(logDate.getDate()).padStart(2, '0');
        for (var j = 0; j < days.length; j++) {
          if (days[j].key === logKey) {
            // Estimate: each log entry represents ~30 min of activity if no duration
            var duration = 0.5; // default 30 min
            if (log.duration) {
              duration = HosUtils.parseTimeSpanToHours(log.duration);
            }
            days[j].hours += duration;
            break;
          }
        }
      }
    });

    // Draw chart
    var padding = { top: 10, right: 10, bottom: 24, left: 30 };
    var chartW = w - padding.left - padding.right;
    var chartH = h - padding.top - padding.bottom;
    var maxHours = 14; // 14-hour duty window
    var barWidth = Math.floor(chartW / days.length) - 8;

    // Y-axis labels
    ctx.fillStyle = '#8DA4B9';
    ctx.font = '10px Roboto Mono, monospace';
    ctx.textAlign = 'right';
    for (var y = 0; y <= maxHours; y += 4) {
      var yPos = padding.top + chartH - (y / maxHours) * chartH;
      ctx.fillText(y + 'h', padding.left - 4, yPos + 3);
      ctx.strokeStyle = '#E6EBEF';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padding.left, yPos);
      ctx.lineTo(w - padding.right, yPos);
      ctx.stroke();
    }

    // Bars
    days.forEach(function (day, idx) {
      var x = padding.left + idx * (chartW / days.length) + 4;
      var barH = Math.min(day.hours / maxHours, 1) * chartH;
      var barY = padding.top + chartH - barH;

      // Bar color based on hours
      if (day.hours > 11) {
        ctx.fillStyle = '#C51A11';
      } else if (day.hours > 8) {
        ctx.fillStyle = '#D4A017';
      } else {
        ctx.fillStyle = '#0078D3';
      }

      ctx.fillRect(x, barY, barWidth, barH);

      // Day label
      ctx.fillStyle = '#4E677E';
      ctx.font = '10px Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(dayLabels[idx], x + barWidth / 2, h - 4);
    });
  }

  /**
   * Render recent status log timeline.
   */
  function renderStatusTimeline(logs) {
    var container = document.getElementById('ecmDetailLogs');

    if (!logs || logs.length === 0) {
      container.innerHTML = '<div class="ecm-no-violations">No recent status log entries</div>';
      return;
    }

    // Sort most recent first
    var sorted = logs.slice().sort(function (a, b) {
      return new Date(b.dateTime) - new Date(a.dateTime);
    });

    var html = '<ul class="ecm-log-timeline">';
    sorted.forEach(function (log) {
      var statusLabel = HosUtils.getStatusLabel(log.status);
      var statusClass = HosUtils.getStatusClass(log.status);
      var time = HosUtils.formatDateTime(log.dateTime);
      var origin = log.origin || '';

      html += '<li class="ecm-log-entry">';
      html += '<span class="ecm-log-time">' + escapeHtml(time) + '</span>';
      html += '<span class="ecm-status-badge ' + statusClass + '">' + escapeHtml(statusLabel) + '</span>';
      if (origin) {
        html += '<span style="font-size:12px;color:var(--text-placeholder);">' + escapeHtml(origin) + '</span>';
      }
      html += '</li>';
    });
    html += '</ul>';

    container.innerHTML = html;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return {
    init: init,
    open: open,
    close: close
  };
})();
