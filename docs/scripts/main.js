/**
 * ELD Compliance Monitor — main.js
 * MyGeotab Add-In: real-time HOS time-remaining visibility for all drivers.
 */

/* global geotab */
if (typeof geotab === "undefined") { var geotab = { addin: {} }; }

geotab.addin.eldComplianceMonitor = function () {
  "use strict";

  // ── State ──
  var api;
  var abortController = null;
  var firstFocus = true;

  var driverCache = {};
  var hosData = [];
  var filteredData = [];
  var loading = false;
  var sortField = "name";
  var sortDir = "asc";
  var currentDriverId = null;

  // Auto-refresh state
  var refreshIntervalSec = 300;
  var refreshRemaining = 0;
  var refreshTimer = null;
  var refreshPaused = false;

  // ── DOM refs ──
  var els = {};

  // ══════════════════════════════════════════
  //  HOS Utilities
  // ══════════════════════════════════════════
  var THRESHOLDS = {
    drive:  { red: 1, yellow: 2 },
    duty:   { red: 1, yellow: 2 },
    cycle:  { red: 4, yellow: 8 },
    break_: { red: 0.25, yellow: 1 }
  };

  function parseTimeSpanToHours(ts) {
    if (ts == null) return 0;
    if (typeof ts === "number") return ts / 3600;
    var str = String(ts).trim();
    if (!str) return 0;
    var negative = false;
    if (str.charAt(0) === "-") { negative = true; str = str.substring(1); }
    var days = 0, timePart = str;
    var dotIdx = str.indexOf("."), colonIdx = str.indexOf(":");
    if (dotIdx >= 0 && (colonIdx < 0 || dotIdx < colonIdx)) {
      days = parseInt(str.substring(0, dotIdx), 10) || 0;
      timePart = str.substring(dotIdx + 1);
    }
    var parts = timePart.split(":");
    var hours = parseInt(parts[0], 10) || 0;
    var minutes = parseInt(parts[1], 10) || 0;
    var seconds = parseFloat(parts[2]) || 0;
    var total = (days * 24) + hours + (minutes / 60) + (seconds / 3600);
    return negative ? -total : total;
  }

  function getUrgency(clockType, hoursRemaining) {
    var key = clockType === "break" ? "break_" : clockType;
    var t = THRESHOLDS[key];
    if (!t) return "green";
    if (hoursRemaining < t.red) return "red";
    if (hoursRemaining < t.yellow) return "yellow";
    return "green";
  }

  function formatHoursMinutes(hours) {
    if (hours == null || isNaN(hours)) return "--:--";
    var neg = hours < 0;
    var abs = Math.abs(hours);
    var h = Math.floor(abs);
    var m = Math.round((abs - h) * 60);
    if (m === 60) { h++; m = 0; }
    var str = h + "h " + (m < 10 ? "0" : "") + m + "m";
    return neg ? "-" + str : str;
  }

  function formatCompact(hours) {
    if (hours == null || isNaN(hours)) return "--:--";
    var neg = hours < 0;
    var abs = Math.abs(hours);
    var h = Math.floor(abs);
    var m = Math.round((abs - h) * 60);
    if (m === 60) { h++; m = 0; }
    var str = (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
    return neg ? "-" + str : str;
  }

  var STATUS_LABELS = {
    "D": "D", "Driving": "D", "ON": "ON", "OnDuty": "ON", "On": "ON",
    "OFF": "OFF", "OffDuty": "OFF", "Off": "OFF", "SB": "SB",
    "SleeperBerth": "SB", "Sleeper": "SB", "PC": "PC",
    "PersonalConveyance": "PC", "YM": "YM", "YardMove": "YM"
  };

  function getStatusLabel(status) {
    if (!status) return "?";
    return STATUS_LABELS[status] || status.substring(0, 3).toUpperCase();
  }

  function getStatusClass(status) {
    var label = getStatusLabel(status);
    switch (label) {
      case "D":   return "ecm-status-driving";
      case "ON":  return "ecm-status-on";
      case "OFF": return "ecm-status-off";
      case "SB":  return "ecm-status-sb";
      case "PC":  return "ecm-status-pc";
      case "YM":  return "ecm-status-ym";
      default:    return "ecm-status-default";
    }
  }

  function extractAvailability(reg) {
    if (!reg || !reg.availability) {
      return { drive: 0, duty: 0, cycle: 0, break_: 0, status: null, violations: [] };
    }
    var avail = reg.availability;
    var drive = 0, duty = 0, cycle = 0, break_ = 0;
    if (Array.isArray(avail)) {
      avail.forEach(function (a) {
        var hours = parseTimeSpanToHours(a.duration);
        var type = (a.type || "").toLowerCase();
        if (type === "driving" || type === "drive") drive = hours;
        else if (type === "duty" || type === "onduty") duty = hours;
        else if (type === "cycle" || type === "cycleduty") cycle = hours;
        else if (type === "rest" || type === "break") break_ = hours;
      });
    }
    var currentStatus = null;
    if (reg.currentDutyStatus && reg.currentDutyStatus.status) {
      currentStatus = reg.currentDutyStatus.status;
    }
    return { drive: drive, duty: duty, cycle: cycle, break_: break_,
             status: currentStatus, violations: Array.isArray(reg.violations) ? reg.violations : [] };
  }

  function formatDateTime(dateStr) {
    if (!dateStr) return "--";
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return "--";
    var month = d.getMonth() + 1, day = d.getDate();
    var h = d.getHours(), m = d.getMinutes();
    var ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return month + "/" + day + " " + h + ":" + (m < 10 ? "0" : "") + m + " " + ampm;
  }

  var HOS_RULE_LABELS = {
    "USFederal7Day": "US 70h/8d", "USFederal8Day": "US 60h/7d",
    "USFederalProperty7Day": "US Property 70h/8d", "USFederalProperty8Day": "US Property 60h/7d",
    "USFederalPassenger7Day": "US Passenger 70h/8d", "USFederalPassenger8Day": "US Passenger 60h/7d",
    "USShortHaul7Day": "US Short-Haul 70h/8d", "USShortHaul8Day": "US Short-Haul 60h/7d",
    "CanadaCycleOne": "Canada Cycle 1 (70h/7d)", "CanadaCycleTwo": "Canada Cycle 2 (120h/14d)"
  };

  function getHosRuleLabel(hosRuleSet) {
    if (!hosRuleSet) return "Unknown";
    var name = hosRuleSet.name || hosRuleSet;
    return HOS_RULE_LABELS[name] || String(name).replace(/([A-Z])/g, " $1").trim();
  }

  // ══════════════════════════════════════════
  //  Helpers
  // ══════════════════════════════════════════
  function escHtml(s) {
    if (s == null) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function showLoading(show, msg) {
    els.loading.style.display = show ? "" : "none";
    if (msg) els.loadingText.textContent = msg;
  }

  function showEmpty(show, msg) {
    els.empty.style.display = show ? "" : "none";
    if (msg) els.empty.querySelector("p").textContent = msg;
  }

  function setStatus(msg, isError) {
    if (msg && msg.indexOf("<") >= 0) {
      els.status.innerHTML = msg;
    } else {
      els.status.textContent = msg || "";
    }
    els.status.className = "ecm-status" + (isError ? " error" : "");
  }

  function sortArrow(col) {
    if (sortField === col) {
      return '<span class="ecm-sort-arrow active">' + (sortDir === "asc" ? "\u25B2" : "\u25BC") + "</span>";
    }
    return '<span class="ecm-sort-arrow">\u25B2\u25BC</span>';
  }

  // ══════════════════════════════════════════
  //  Foundation Data
  // ══════════════════════════════════════════
  function loadFoundation(callback) {
    api.call("Get", {
      typeName: "User",
      search: { isDriver: true },
      resultsLimit: 5000
    }, function (users) {
      driverCache = {};
      (users || []).forEach(function (u) {
        driverCache[u.id] = {
          name: ((u.firstName || "") + " " + (u.lastName || "")).trim(),
          firstName: u.firstName || "",
          lastName: u.lastName || "",
          hosRuleSet: u.hosRuleSet || null
        };
      });
      callback();
    }, function (err) {
      console.error("Driver load error:", err);
      callback();
    });
  }

  function getDriversSorted() {
    return Object.keys(driverCache).map(function (id) {
      return { id: id, name: driverCache[id].name.trim() || "Unknown Driver", hosRuleSet: driverCache[id].hosRuleSet };
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  // ══════════════════════════════════════════
  //  HOS Data Fetch (batched multiCall)
  // ══════════════════════════════════════════
  var BATCH_SIZE = 20;

  function fetchAllHosData(onProgress) {
    var driverList = getDriversSorted();
    if (driverList.length === 0) return Promise.resolve([]);

    var batches = [];
    for (var i = 0; i < driverList.length; i += BATCH_SIZE) {
      batches.push(driverList.slice(i, i + BATCH_SIZE));
    }

    if (onProgress) onProgress("Fetching HOS data for " + driverList.length + " drivers...");

    var allResults = [];
    var batchIndex = 0;

    function processBatch() {
      if (batchIndex >= batches.length) return Promise.resolve(allResults);
      var batch = batches[batchIndex++];

      if (onProgress) {
        var fetched = Math.min(batchIndex * BATCH_SIZE, driverList.length);
        onProgress("Fetching HOS data... (" + fetched + "/" + driverList.length + ")");
      }

      var calls = batch.map(function (driver) {
        return ["Get", { typeName: "DriverRegulation", search: { userSearch: { id: driver.id } } }];
      });

      return new Promise(function (resolve, reject) {
        api.multiCall(calls, function (results) {
          for (var j = 0; j < batch.length; j++) {
            var reg = (results[j] && results[j].length > 0) ? results[j][0] : null;
            var avail = extractAvailability(reg);
            allResults.push({
              driverId: batch[j].id, name: batch[j].name, hosRuleSet: batch[j].hosRuleSet,
              drive: avail.drive, duty: avail.duty, cycle: avail.cycle, break_: avail.break_,
              status: avail.status, violations: avail.violations, raw: reg
            });
          }
          resolve();
        }, function (err) {
          for (var j = 0; j < batch.length; j++) {
            allResults.push({
              driverId: batch[j].id, name: batch[j].name, hosRuleSet: batch[j].hosRuleSet,
              drive: 0, duty: 0, cycle: 0, break_: 0, status: null, violations: [], raw: null,
              error: err ? (err.message || String(err)) : "Unknown error"
            });
          }
          resolve();
        });
      }).then(processBatch);
    }

    return processBatch();
  }

  // ══════════════════════════════════════════
  //  Data Refresh
  // ══════════════════════════════════════════
  function refreshData() {
    if (loading) return Promise.resolve();
    loading = true;
    els.refreshBtn.disabled = true;

    return fetchAllHosData(function (msg) {
      setStatus('<span class="ecm-spinner-sm"></span>' + msg);
    }).then(function (data) {
      hosData = data;
      loading = false;
      els.refreshBtn.disabled = false;
      renderFleetTable();
      resetRefreshTimer();
      startRefreshTimer();
      setStatus("");
    }).catch(function (err) {
      loading = false;
      els.refreshBtn.disabled = false;
      setStatus("Refresh error: " + (err.message || err), true);
      resetRefreshTimer();
      startRefreshTimer();
    });
  }

  // ══════════════════════════════════════════
  //  Fleet Table Rendering
  // ══════════════════════════════════════════
  function renderFleetTable() {
    var searchVal = (els.search.value || "").toLowerCase().trim();

    if (!searchVal) {
      filteredData = hosData.slice();
    } else {
      filteredData = hosData.filter(function (d) {
        return d.name.toLowerCase().indexOf(searchVal) >= 0;
      });
    }

    // Sort
    filteredData.sort(function (a, b) {
      var va, vb;
      switch (sortField) {
        case "name": return sortDir === "asc" ? (a.name || "").localeCompare(b.name || "") : (b.name || "").localeCompare(a.name || "");
        case "status":
          va = getStatusLabel(a.status); vb = getStatusLabel(b.status);
          return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
        case "drive": va = a.drive || 0; vb = b.drive || 0; break;
        case "duty": va = a.duty || 0; vb = b.duty || 0; break;
        case "break": va = a.break_ || 0; vb = b.break_ || 0; break;
        case "cycle": va = a.cycle || 0; vb = b.cycle || 0; break;
        case "violations": va = (a.violations || []).length; vb = (b.violations || []).length; break;
        default: return 0;
      }
      return sortDir === "asc" ? va - vb : vb - va;
    });

    // Update headers
    var thead = els.fleetTable.querySelector("thead");
    thead.innerHTML = "<tr>" +
      '<th class="ecm-sortable" data-sort="name">Driver ' + sortArrow("name") + "</th>" +
      '<th class="ecm-sortable" data-sort="status">Status ' + sortArrow("status") + "</th>" +
      '<th class="ecm-sortable" data-sort="drive">Drive Remaining ' + sortArrow("drive") + "</th>" +
      '<th class="ecm-sortable" data-sort="duty">Duty Remaining ' + sortArrow("duty") + "</th>" +
      '<th class="ecm-sortable" data-sort="break">Break ' + sortArrow("break") + "</th>" +
      '<th class="ecm-sortable" data-sort="cycle">Cycle Remaining ' + sortArrow("cycle") + "</th>" +
      '<th class="ecm-sortable" data-sort="violations">Violations ' + sortArrow("violations") + "</th>" +
      "</tr>";

    // Rows
    var tbody = els.fleetBody;
    tbody.innerHTML = "";

    if (filteredData.length === 0) {
      var msg = hosData.length === 0 ? "No driver data available." : "No drivers match your search.";
      showEmpty(true, msg);
      updateSummary();
      return;
    }

    showEmpty(false);
    var html = "";
    filteredData.forEach(function (d) {
      var statusLabel = getStatusLabel(d.status);
      var statusClass = getStatusClass(d.status);
      var violCount = (d.violations || []).length;

      html += '<tr data-driver-id="' + escHtml(d.driverId) + '">';
      html += "<td>" + escHtml(d.name) + "</td>";
      html += '<td><span class="ecm-status-badge ' + statusClass + '">' + escHtml(statusLabel) + "</span></td>";
      html += '<td><span class="ecm-time-cell ' + getUrgency("drive", d.drive) + '">' + formatCompact(d.drive) + "</span></td>";
      html += '<td><span class="ecm-time-cell ' + getUrgency("duty", d.duty) + '">' + formatCompact(d.duty) + "</span></td>";
      html += '<td><span class="ecm-time-cell ' + getUrgency("break", d.break_) + '">' + formatCompact(d.break_) + "</span></td>";
      html += '<td><span class="ecm-time-cell ' + getUrgency("cycle", d.cycle) + '">' + formatCompact(d.cycle) + "</span></td>";
      html += '<td><span class="ecm-viol-count ' + (violCount > 0 ? "has-violations" : "no-violations") + '">' + violCount + "</span></td>";
      html += "</tr>";
    });
    tbody.innerHTML = html;
    updateSummary();
  }

  function updateSummary() {
    els.driverCount.textContent = hosData.length + " driver" + (hosData.length !== 1 ? "s" : "");
    var totalViolations = 0;
    hosData.forEach(function (d) { totalViolations += (d.violations || []).length; });
    els.violationsSummary.textContent = totalViolations + " Violation" + (totalViolations !== 1 ? "s" : "");
    if (totalViolations > 0) { els.violationsSummary.classList.remove("none"); }
    else { els.violationsSummary.classList.add("none"); }
  }

  // ══════════════════════════════════════════
  //  Detail Panel
  // ══════════════════════════════════════════
  function openDetail(driverData) {
    currentDriverId = driverData.driverId;

    document.getElementById("ecm-detail-name").textContent = driverData.name;
    document.getElementById("ecm-detail-ruleset").textContent = getHosRuleLabel(driverData.hosRuleSet);

    var statusEl = document.getElementById("ecm-detail-status");
    statusEl.textContent = getStatusLabel(driverData.status);
    statusEl.className = "ecm-status-badge " + getStatusClass(driverData.status);

    renderGauge("ecm-gauge-drive", driverData.drive, 11, "drive");
    document.getElementById("ecm-gauge-drive-val").textContent = formatHoursMinutes(driverData.drive);
    renderGauge("ecm-gauge-duty", driverData.duty, 14, "duty");
    document.getElementById("ecm-gauge-duty-val").textContent = formatHoursMinutes(driverData.duty);
    renderGauge("ecm-gauge-cycle", driverData.cycle, 70, "cycle");
    document.getElementById("ecm-gauge-cycle-val").textContent = formatHoursMinutes(driverData.cycle);
    renderGauge("ecm-gauge-break", driverData.break_, 0.5, "break");
    document.getElementById("ecm-gauge-break-val").textContent = formatHoursMinutes(driverData.break_);

    renderViolations(driverData.violations);

    document.getElementById("ecm-detail-overlay").classList.add("open");
    document.getElementById("ecm-detail-panel").classList.add("open");

    loadDetailData(driverData.driverId);
  }

  function closeDetail() {
    currentDriverId = null;
    document.getElementById("ecm-detail-overlay").classList.remove("open");
    document.getElementById("ecm-detail-panel").classList.remove("open");
  }

  function renderGauge(svgId, value, max, clockType) {
    var svg = document.getElementById(svgId);
    if (!svg) return;
    var ratio = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;
    var urgency = getUrgency(clockType, value);
    var colors = { green: "#2e7d32", yellow: "#e65100", red: "#c62828" };
    var color = colors[urgency] || colors.green;
    var cx = 50, cy = 60, r = 40;
    var startAngle = Math.PI, endAngle = 0;
    var bgPath = describeArc(cx, cy, r, startAngle, endAngle);
    var valueAngle = startAngle - (ratio * Math.PI);
    var valPath = describeArc(cx, cy, r, startAngle, valueAngle);
    svg.innerHTML =
      '<path d="' + bgPath + '" fill="none" stroke="#ddd" stroke-width="8" stroke-linecap="round"/>' +
      '<path d="' + valPath + '" fill="none" stroke="' + color + '" stroke-width="8" stroke-linecap="round"/>';
  }

  function describeArc(cx, cy, r, startAngle, endAngle) {
    var x1 = cx + r * Math.cos(startAngle), y1 = cy - r * Math.sin(startAngle);
    var x2 = cx + r * Math.cos(endAngle), y2 = cy - r * Math.sin(endAngle);
    var largeArc = (startAngle - endAngle) > Math.PI ? 1 : 0;
    return "M " + x1.toFixed(2) + " " + y1.toFixed(2) +
           " A " + r + " " + r + " 0 " + largeArc + " 1 " + x2.toFixed(2) + " " + y2.toFixed(2);
  }

  function renderViolations(violations) {
    var container = document.getElementById("ecm-detail-violations");
    if (!violations || violations.length === 0) {
      container.innerHTML = '<div class="ecm-no-violations">No active violations</div>';
      return;
    }
    var html = '<ul style="list-style:none;padding:0;margin:0;">';
    violations.forEach(function (v) {
      var type = v.type || v.name || "Violation";
      var time = formatDateTime(v.dateTime || v.fromDate);
      var duration = "";
      if (v.duration) { duration = " (" + formatHoursMinutes(parseTimeSpanToHours(v.duration)) + ")"; }
      html += '<li class="ecm-violation-item"><div>';
      html += '<div class="ecm-viol-type">' + escHtml(String(type).replace(/([A-Z])/g, " $1").trim()) + "</div>";
      html += '<div class="ecm-viol-detail">' + escHtml(time) + escHtml(duration) + "</div>";
      html += "</div></li>";
    });
    html += "</ul>";
    container.innerHTML = html;
  }

  function loadDetailData(driverId) {
    var logsContainer = document.getElementById("ecm-detail-logs");
    logsContainer.innerHTML = '<div class="ecm-detail-loading"><span class="ecm-spinner-sm"></span> Loading logs...</div>';

    var toDate = new Date(), fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 7);

    var calls = [
      ["Get", { typeName: "DutyStatusLog", search: { userSearch: { id: driverId }, fromDate: fromDate.toISOString(), toDate: toDate.toISOString() }, resultsLimit: 500 }],
      ["Get", { typeName: "DutyStatusLog", search: { userSearch: { id: driverId }, fromDate: fromDate.toISOString(), toDate: toDate.toISOString() }, resultsLimit: 20 }]
    ];

    api.multiCall(calls, function (results) {
      if (driverId !== currentDriverId) return;
      renderRecapChart(results[0] || []);
      renderStatusTimeline(results[1] || []);
    }, function (err) {
      if (driverId !== currentDriverId) return;
      logsContainer.innerHTML = '<div class="ecm-status error">Failed to load logs: ' + escHtml(err.message || String(err)) + "</div>";
      renderRecapChart([]);
    });
  }

  function renderRecapChart(logs) {
    var canvas = document.getElementById("ecm-recap-canvas");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    var rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width - 24;
    canvas.height = rect.height - 24;
    var w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    var days = [], dayLabels = [], now = new Date();
    var dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    for (var i = 6; i >= 0; i--) {
      var d = new Date(now); d.setDate(d.getDate() - i);
      var key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      days.push({ key: key, hours: 0 });
      dayLabels.push(dayNames[d.getDay()]);
    }

    (logs || []).forEach(function (log) {
      if (!log.dateTime) return;
      var status = log.status || "";
      if (status === "D" || status === "Driving" || status === "ON" || status === "OnDuty" || status === "On") {
        var logDate = new Date(log.dateTime);
        var logKey = logDate.getFullYear() + "-" + String(logDate.getMonth() + 1).padStart(2, "0") + "-" + String(logDate.getDate()).padStart(2, "0");
        for (var j = 0; j < days.length; j++) {
          if (days[j].key === logKey) {
            days[j].hours += log.duration ? parseTimeSpanToHours(log.duration) : 0.5;
            break;
          }
        }
      }
    });

    var padding = { top: 10, right: 10, bottom: 24, left: 30 };
    var chartW = w - padding.left - padding.right;
    var chartH = h - padding.top - padding.bottom;
    var maxHours = 14;
    var barWidth = Math.floor(chartW / days.length) - 8;

    ctx.fillStyle = "#999"; ctx.font = "10px monospace"; ctx.textAlign = "right";
    for (var y = 0; y <= maxHours; y += 4) {
      var yPos = padding.top + chartH - (y / maxHours) * chartH;
      ctx.fillText(y + "h", padding.left - 4, yPos + 3);
      ctx.strokeStyle = "#eee"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padding.left, yPos); ctx.lineTo(w - padding.right, yPos); ctx.stroke();
    }

    days.forEach(function (day, idx) {
      var x = padding.left + idx * (chartW / days.length) + 4;
      var barH = Math.min(day.hours / maxHours, 1) * chartH;
      var barY = padding.top + chartH - barH;
      ctx.fillStyle = day.hours > 11 ? "#c62828" : day.hours > 8 ? "#e65100" : "#4a90d9";
      ctx.fillRect(x, barY, barWidth, barH);
      ctx.fillStyle = "#666"; ctx.font = "10px sans-serif"; ctx.textAlign = "center";
      ctx.fillText(dayLabels[idx], x + barWidth / 2, h - 4);
    });
  }

  function renderStatusTimeline(logs) {
    var container = document.getElementById("ecm-detail-logs");
    if (!logs || logs.length === 0) {
      container.innerHTML = '<div class="ecm-no-violations">No recent status log entries</div>';
      return;
    }
    var sorted = logs.slice().sort(function (a, b) { return new Date(b.dateTime) - new Date(a.dateTime); });
    var html = '<ul class="ecm-log-timeline">';
    sorted.forEach(function (log) {
      html += '<li class="ecm-log-entry">';
      html += '<span class="ecm-log-time">' + escHtml(formatDateTime(log.dateTime)) + "</span>";
      html += '<span class="ecm-status-badge ' + getStatusClass(log.status) + '">' + escHtml(getStatusLabel(log.status)) + "</span>";
      if (log.origin) html += '<span style="font-size:12px;color:#999;">' + escHtml(log.origin) + "</span>";
      html += "</li>";
    });
    html += "</ul>";
    container.innerHTML = html;
  }

  // ══════════════════════════════════════════
  //  Auto-Refresh Timer
  // ══════════════════════════════════════════
  function startRefreshTimer() {
    refreshRemaining = refreshIntervalSec;
    refreshPaused = false;
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(function () {
      if (refreshPaused) return;
      refreshRemaining--;
      updateCountdown();
      if (refreshRemaining <= 0) {
        refreshRemaining = refreshIntervalSec;
        refreshData();
      }
    }, 1000);
    updateCountdown();
  }

  function resetRefreshTimer() {
    refreshRemaining = refreshIntervalSec;
    updateCountdown();
  }

  function stopRefreshTimer() {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    refreshRemaining = 0;
    updateCountdown();
  }

  function updateCountdown() {
    if (!els.countdown) return;
    if (refreshPaused) { els.countdown.textContent = "paused"; return; }
    var m = Math.floor(refreshRemaining / 60);
    var s = refreshRemaining % 60;
    els.countdown.textContent = m + ":" + (s < 10 ? "0" : "") + s;
  }

  // ══════════════════════════════════════════
  //  Event Wiring
  // ══════════════════════════════════════════
  function wireEvents() {
    // Refresh button
    els.refreshBtn.addEventListener("click", function () { refreshData(); });

    // Search
    els.search.addEventListener("input", function () { renderFleetTable(); });

    // Refresh interval change
    els.refreshInterval.addEventListener("change", function () {
      refreshIntervalSec = parseInt(els.refreshInterval.value, 10) || 300;
      resetRefreshTimer();
    });

    // Table sorting (delegation)
    els.fleetTable.addEventListener("click", function (e) {
      var th = e.target.closest("th.ecm-sortable");
      if (!th) return;
      var col = th.getAttribute("data-sort");
      if (!col) return;
      if (sortField === col) { sortDir = sortDir === "asc" ? "desc" : "asc"; }
      else { sortField = col; sortDir = "asc"; }
      renderFleetTable();
    });

    // Row click → detail panel (delegation)
    els.fleetBody.addEventListener("click", function (e) {
      var tr = e.target.closest("tr");
      if (!tr) return;
      var driverId = tr.getAttribute("data-driver-id");
      var driverData = hosData.find(function (d) { return d.driverId === driverId; });
      if (driverData) {
        els.fleetBody.querySelectorAll("tr").forEach(function (r) { r.classList.remove("ecm-row-selected"); });
        tr.classList.add("ecm-row-selected");
        openDetail(driverData);
      }
    });

    // Detail close
    document.getElementById("ecm-detail-close").addEventListener("click", closeDetail);
    document.getElementById("ecm-detail-overlay").addEventListener("click", closeDetail);

    // Pause refresh on window blur
    window.addEventListener("blur", function () {
      refreshPaused = true;
      updateCountdown();
    });
    window.addEventListener("focus", function () {
      if (refreshPaused) {
        refreshPaused = false;
        if (refreshRemaining <= 0) refreshData();
        updateCountdown();
      }
    });
  }

  // ══════════════════════════════════════════
  //  MyGeotab Lifecycle
  // ══════════════════════════════════════════
  return {
    initialize: function (freshApi, state, callback) {
      api = freshApi;

      els.loading = document.getElementById("ecm-loading");
      els.loadingText = document.getElementById("ecm-loading-text");
      els.empty = document.getElementById("ecm-empty");
      els.status = document.getElementById("ecm-status");
      els.search = document.getElementById("ecm-search");
      els.driverCount = document.getElementById("ecm-driver-count");
      els.violationsSummary = document.getElementById("ecm-violations-summary");
      els.refreshBtn = document.getElementById("ecm-refresh-btn");
      els.refreshInterval = document.getElementById("ecm-refresh-interval");
      els.countdown = document.getElementById("ecm-countdown");
      els.fleetTable = document.getElementById("ecm-fleet-table");
      els.fleetBody = document.getElementById("ecm-fleet-body");

      wireEvents();

      if (api) {
        setStatus('<span class="ecm-spinner-sm"></span>Loading drivers...');
        loadFoundation(function () {
          var count = Object.keys(driverCache).length;
          setStatus('<span class="ecm-spinner-sm"></span>Loaded ' + count + ' drivers. Fetching HOS data...');
          refreshData().then(function () {
            setStatus("");
            callback();
          }).catch(function (err) {
            setStatus("Error loading data: " + (err.message || err), true);
            callback();
          });
        });
      } else {
        callback();
      }
    },

    focus: function (freshApi, state) {
      api = freshApi;
      if (firstFocus) {
        firstFocus = false;
        startRefreshTimer();
      }
    },

    blur: function () {
      stopRefreshTimer();
      if (abortController) { abortController.abort(); abortController = null; }
      showLoading(false);
    }
  };
};

// ══════════════════════════════════════════
//  Standalone Mode (preview outside MyGeotab)
// ══════════════════════════════════════════
(function () {
  setTimeout(function () {
    if (typeof geotab !== "undefined" && typeof geotab.addin.eldComplianceMonitor === "function") {
      var root = document.getElementById("ecm-root");
      if (root && !root._initialized) {
        root._initialized = true;
        var addin = geotab.addin.eldComplianceMonitor();
        addin.initialize(null, {}, function () {
          addin.focus(null, {});
        });
      }
    }
  }, 2000);
})();
