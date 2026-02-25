/**
 * driverCache.js — Loads all drivers (isDriver: true) and caches id → name + hosRuleSet.
 * Depends on: (nothing — uses api passed at init time)
 */
var DriverCache = (function () {
  'use strict';

  var drivers = {};  // { id: { name, firstName, lastName, hosRuleSet } }
  var loaded = false;

  /**
   * Load all drivers from the User API.
   * @param {object} api — MyGeotab api object
   * @returns {Promise}
   */
  function init(api) {
    return new Promise(function (resolve, reject) {
      api.call('Get', {
        typeName: 'User',
        search: { isDriver: true },
        resultsLimit: 5000
      }, function (users) {
        drivers = {};
        (users || []).forEach(function (u) {
          drivers[u.id] = {
            name: (u.firstName || '') + ' ' + (u.lastName || ''),
            firstName: u.firstName || '',
            lastName: u.lastName || '',
            hosRuleSet: u.hosRuleSet || null
          };
        });
        loaded = true;
        resolve();
      }, function (err) {
        reject(err);
      });
    });
  }

  /**
   * Get all drivers as { id: { name, hosRuleSet } }.
   */
  function getAll() {
    return drivers;
  }

  /**
   * Get a single driver by ID.
   */
  function get(id) {
    return drivers[id] || null;
  }

  /**
   * Get sorted array of { id, name, hosRuleSet }.
   */
  function getSorted() {
    return Object.keys(drivers).map(function (id) {
      return {
        id: id,
        name: drivers[id].name.trim() || 'Unknown Driver',
        hosRuleSet: drivers[id].hosRuleSet
      };
    }).sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * Get driver name by ID, with fallback.
   */
  function getName(id) {
    var d = drivers[id];
    return d ? d.name.trim() || 'Unknown Driver' : 'Driver ' + (id || '?');
  }

  /**
   * Get count of loaded drivers.
   */
  function count() {
    return Object.keys(drivers).length;
  }

  /**
   * Get friendly HOS ruleset label.
   */
  function getHosRuleLabel(hosRuleSet) {
    if (!hosRuleSet) return 'Unknown';
    var name = hosRuleSet.name || hosRuleSet;
    var labels = {
      'USFederal7Day': 'US 70h/8d',
      'USFederal8Day': 'US 60h/7d',
      'USFederalProperty7Day': 'US Property 70h/8d',
      'USFederalProperty8Day': 'US Property 60h/7d',
      'USFederalPassenger7Day': 'US Passenger 70h/8d',
      'USFederalPassenger8Day': 'US Passenger 60h/7d',
      'USTexas7Day': 'Texas 70h/7d',
      'USShortHaul7Day': 'US Short-Haul 70h/8d',
      'USShortHaul8Day': 'US Short-Haul 60h/7d',
      'CanadaCycleOne': 'Canada Cycle 1 (70h/7d)',
      'CanadaCycleTwo': 'Canada Cycle 2 (120h/14d)',
      'CanadaNorthOf60CycleOne': 'Canada North Cycle 1',
      'CanadaNorthOf60CycleTwo': 'Canada North Cycle 2'
    };
    return labels[name] || String(name).replace(/([A-Z])/g, ' $1').trim();
  }

  return {
    init: init,
    getAll: getAll,
    get: get,
    getSorted: getSorted,
    getName: getName,
    count: count,
    getHosRuleLabel: getHosRuleLabel
  };
})();
