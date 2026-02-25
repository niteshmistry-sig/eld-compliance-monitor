/**
 * hosDataService.js — Fetches DriverRegulation data via batched multiCall.
 * Depends on: HosUtils, DriverCache
 */
var HosDataService = (function () {
  'use strict';

  var BATCH_SIZE = 20;

  /**
   * Fetch DriverRegulation for all drivers in batches.
   * @param {object} api — MyGeotab api object
   * @param {function} onProgress — optional progress callback(message)
   * @returns {Promise<Array>} — array of { driverId, name, hosRuleSet, availability, raw }
   */
  function fetchAll(api, onProgress) {
    var driverList = DriverCache.getSorted();
    if (driverList.length === 0) {
      return Promise.resolve([]);
    }

    // Split into batches
    var batches = [];
    for (var i = 0; i < driverList.length; i += BATCH_SIZE) {
      batches.push(driverList.slice(i, i + BATCH_SIZE));
    }

    if (onProgress) {
      onProgress('Fetching HOS data for ' + driverList.length + ' drivers...');
    }

    var allResults = [];
    var batchIndex = 0;

    function processBatch() {
      if (batchIndex >= batches.length) {
        return Promise.resolve(allResults);
      }

      var batch = batches[batchIndex];
      batchIndex++;

      if (onProgress) {
        var fetched = Math.min(batchIndex * BATCH_SIZE, driverList.length);
        onProgress('Fetching HOS data... (' + fetched + '/' + driverList.length + ')');
      }

      var calls = batch.map(function (driver) {
        return ['Get', {
          typeName: 'DriverRegulation',
          search: {
            userSearch: { id: driver.id }
          }
        }];
      });

      return new Promise(function (resolve, reject) {
        api.multiCall(calls, function (results) {
          for (var j = 0; j < batch.length; j++) {
            var reg = (results[j] && results[j].length > 0) ? results[j][0] : null;
            var avail = HosUtils.extractAvailability(reg);

            allResults.push({
              driverId: batch[j].id,
              name: batch[j].name,
              hosRuleSet: batch[j].hosRuleSet,
              drive: avail.drive,
              duty: avail.duty,
              cycle: avail.cycle,
              break_: avail.break_,
              status: avail.status,
              violations: avail.violations,
              raw: reg
            });
          }
          resolve();
        }, function (err) {
          // On batch error, fill with error placeholders so we don't lose other data
          for (var j = 0; j < batch.length; j++) {
            allResults.push({
              driverId: batch[j].id,
              name: batch[j].name,
              hosRuleSet: batch[j].hosRuleSet,
              drive: 0,
              duty: 0,
              cycle: 0,
              break_: 0,
              status: null,
              violations: [],
              raw: null,
              error: err ? (err.message || String(err)) : 'Unknown error'
            });
          }
          resolve(); // Don't reject — continue processing remaining batches
        });
      }).then(processBatch);
    }

    return processBatch();
  }

  /**
   * Fetch DutyStatusLog entries for a single driver (for detail view).
   * @param {object} api
   * @param {string} driverId
   * @param {number} limit — max entries to return (default 20)
   * @returns {Promise<Array>}
   */
  function fetchDutyStatusLogs(api, driverId, limit) {
    limit = limit || 20;

    // Get logs from the last 7 days
    var toDate = new Date();
    var fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 7);

    return new Promise(function (resolve, reject) {
      api.call('Get', {
        typeName: 'DutyStatusLog',
        search: {
          userSearch: { id: driverId },
          fromDate: fromDate.toISOString(),
          toDate: toDate.toISOString()
        },
        resultsLimit: limit
      }, function (logs) {
        resolve(logs || []);
      }, function (err) {
        reject(err);
      });
    });
  }

  /**
   * Fetch DutyStatusLog entries for the last 7 days (for recap chart).
   * @param {object} api
   * @param {string} driverId
   * @returns {Promise<Array>}
   */
  function fetchRecapLogs(api, driverId) {
    var toDate = new Date();
    var fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 7);

    return new Promise(function (resolve, reject) {
      api.call('Get', {
        typeName: 'DutyStatusLog',
        search: {
          userSearch: { id: driverId },
          fromDate: fromDate.toISOString(),
          toDate: toDate.toISOString()
        },
        resultsLimit: 500
      }, function (logs) {
        resolve(logs || []);
      }, function (err) {
        reject(err);
      });
    });
  }

  return {
    fetchAll: fetchAll,
    fetchDutyStatusLogs: fetchDutyStatusLogs,
    fetchRecapLogs: fetchRecapLogs
  };
})();
