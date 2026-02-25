/**
 * hosUtils.js — TimeSpan parsing, urgency thresholds, and formatting.
 * No external dependencies.
 */
var HosUtils = (function () {
  'use strict';

  // Urgency thresholds in hours
  var THRESHOLDS = {
    drive:  { red: 1, yellow: 2 },
    duty:   { red: 1, yellow: 2 },
    cycle:  { red: 4, yellow: 8 },
    break_: { red: 0.25, yellow: 1 }  // 15 min, 60 min
  };

  /**
   * Parse a Geotab TimeSpan string like "14.05:30:00" or "05:30:00"
   * into total hours (float).
   * Also handles ISO 8601 duration-style or plain numeric seconds.
   * Returns 0 if unparseable.
   */
  function parseTimeSpanToHours(ts) {
    if (ts == null) return 0;

    // If already a number (seconds from API), convert
    if (typeof ts === 'number') {
      return ts / 3600;
    }

    var str = String(ts).trim();
    if (!str) return 0;

    // Handle negative spans
    var negative = false;
    if (str.charAt(0) === '-') {
      negative = true;
      str = str.substring(1);
    }

    var days = 0;
    var timePart = str;

    // "D.HH:MM:SS" format
    var dotIdx = str.indexOf('.');
    var colonIdx = str.indexOf(':');

    if (dotIdx >= 0 && (colonIdx < 0 || dotIdx < colonIdx)) {
      days = parseInt(str.substring(0, dotIdx), 10) || 0;
      timePart = str.substring(dotIdx + 1);
    }

    var parts = timePart.split(':');
    var hours = parseInt(parts[0], 10) || 0;
    var minutes = parseInt(parts[1], 10) || 0;
    var seconds = parseFloat(parts[2]) || 0;

    var total = (days * 24) + hours + (minutes / 60) + (seconds / 3600);
    return negative ? -total : total;
  }

  /**
   * Get urgency level for a given clock type and remaining hours.
   * @param {string} clockType — 'drive', 'duty', 'cycle', or 'break'
   * @param {number} hoursRemaining
   * @returns {string} 'red', 'yellow', or 'green'
   */
  function getUrgency(clockType, hoursRemaining) {
    var key = clockType === 'break' ? 'break_' : clockType;
    var t = THRESHOLDS[key];
    if (!t) return 'green';

    if (hoursRemaining < t.red) return 'red';
    if (hoursRemaining < t.yellow) return 'yellow';
    return 'green';
  }

  /**
   * Format hours (float) as "Hh MMm" string.
   * e.g. 5.5 → "5h 30m", 0.25 → "0h 15m"
   */
  function formatHoursMinutes(hours) {
    if (hours == null || isNaN(hours)) return '--:--';
    var neg = hours < 0;
    var abs = Math.abs(hours);
    var h = Math.floor(abs);
    var m = Math.round((abs - h) * 60);
    if (m === 60) { h++; m = 0; }
    var str = h + 'h ' + (m < 10 ? '0' : '') + m + 'm';
    return neg ? '-' + str : str;
  }

  /**
   * Format hours as "HH:MM" for compact display.
   */
  function formatCompact(hours) {
    if (hours == null || isNaN(hours)) return '--:--';
    var neg = hours < 0;
    var abs = Math.abs(hours);
    var h = Math.floor(abs);
    var m = Math.round((abs - h) * 60);
    if (m === 60) { h++; m = 0; }
    var str = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    return neg ? '-' + str : str;
  }

  /**
   * Map duty status string to a short badge label.
   */
  var STATUS_LABELS = {
    'D': 'D',
    'Driving': 'D',
    'ON': 'ON',
    'OnDuty': 'ON',
    'On': 'ON',
    'OFF': 'OFF',
    'OffDuty': 'OFF',
    'Off': 'OFF',
    'SB': 'SB',
    'SleeperBerth': 'SB',
    'Sleeper': 'SB',
    'PC': 'PC',
    'PersonalConveyance': 'PC',
    'YM': 'YM',
    'YardMove': 'YM',
    'WT': 'WT',
    'WaitTime': 'WT'
  };

  function getStatusLabel(status) {
    if (!status) return '?';
    return STATUS_LABELS[status] || status.substring(0, 3).toUpperCase();
  }

  /**
   * Get CSS class for a duty status badge.
   */
  function getStatusClass(status) {
    var label = getStatusLabel(status);
    switch (label) {
      case 'D':   return 'ecm-status-driving';
      case 'ON':  return 'ecm-status-on';
      case 'OFF': return 'ecm-status-off';
      case 'SB':  return 'ecm-status-sb';
      case 'PC':  return 'ecm-status-pc';
      case 'YM':  return 'ecm-status-ym';
      default:    return 'ecm-status-default';
    }
  }

  /**
   * Extract availability data from a DriverRegulation result.
   * Returns a normalized object with hours remaining for each clock.
   */
  function extractAvailability(reg) {
    if (!reg || !reg.availability) {
      return { drive: 0, duty: 0, cycle: 0, break_: 0, status: null, violations: [] };
    }

    var avail = reg.availability;
    var drive = 0;
    var duty = 0;
    var cycle = 0;
    var break_ = 0;

    // Availability is an array of DutyStatusAvailability objects
    if (Array.isArray(avail)) {
      avail.forEach(function (a) {
        var hours = parseTimeSpanToHours(a.duration);
        var type = (a.type || '').toLowerCase();
        if (type === 'driving' || type === 'drive') {
          drive = hours;
        } else if (type === 'duty' || type === 'onduty') {
          duty = hours;
        } else if (type === 'cycle' || type === 'cycleduty') {
          cycle = hours;
        } else if (type === 'rest' || type === 'break') {
          break_ = hours;
        }
      });
    }

    var currentStatus = null;
    if (reg.currentDutyStatus && reg.currentDutyStatus.status) {
      currentStatus = reg.currentDutyStatus.status;
    }

    var violations = [];
    if (Array.isArray(reg.violations)) {
      violations = reg.violations;
    }

    return {
      drive: drive,
      duty: duty,
      cycle: cycle,
      break_: break_,
      status: currentStatus,
      violations: violations
    };
  }

  /**
   * Format a date for display.
   */
  function formatDateTime(dateStr) {
    if (!dateStr) return '--';
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return '--';
    var month = d.getMonth() + 1;
    var day = d.getDate();
    var h = d.getHours();
    var m = d.getMinutes();
    var ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return month + '/' + day + ' ' + h + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
  }

  return {
    parseTimeSpanToHours: parseTimeSpanToHours,
    getUrgency: getUrgency,
    formatHoursMinutes: formatHoursMinutes,
    formatCompact: formatCompact,
    getStatusLabel: getStatusLabel,
    getStatusClass: getStatusClass,
    extractAvailability: extractAvailability,
    formatDateTime: formatDateTime,
    THRESHOLDS: THRESHOLDS
  };
})();
