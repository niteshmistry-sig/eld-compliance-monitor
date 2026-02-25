#!/usr/bin/env node
/**
 * build.js — Builds the ELD Compliance Monitor add-in:
 *   1. Assembles src/ into a single docs/index.html (for GitHub Pages hosting)
 *   2. Generates config.json with cache-busting timestamp in the URL
 *
 * Usage:  node build.js <github-username>
 * Output: docs/index.html, docs/images/icon.svg, config.json
 */

'use strict';

var fs = require('fs');
var path = require('path');

var SRC = path.join(__dirname, 'src');
var DIST = path.join(__dirname, 'docs');
var OUT = path.join(__dirname, 'config.json');

var githubUser = process.argv[2] || 'YOUR_GITHUB_USERNAME';
var repoName = 'eld-compliance-monitor';
var baseUrl = 'https://' + githubUser + '.github.io/' + repoName;

// Cache-busting: timestamp appended to URL in config.json
var cacheBust = Date.now();

// Read source files
function readSrc(relPath) {
  return fs.readFileSync(path.join(SRC, relPath), 'utf8');
}

// ---- Read all source files ----

var css = readSrc('css/style.css');

var jsFiles = [
  'js/hosUtils.js',
  'js/driverCache.js',
  'js/hosDataService.js',
  'js/fleetView.js',
  'js/detailView.js',
  'js/autoRefresh.js',
  'js/main.js'
];

var jsContents = {};
jsFiles.forEach(function (f) {
  jsContents[f] = readSrc(f);
});

// ---- Build the HTML with embedded CSS and JS ----

var html = readSrc('index.html');

// Replace CSS placeholder
html = html.replace('/* STYLES_PLACEHOLDER */', css);

// Replace each JS placeholder with actual script content
jsFiles.forEach(function (f) {
  var placeholder = '/* SCRIPT:' + f + ' */';
  html = html.replace(placeholder, jsContents[f]);
});

// ---- Write docs/ files ----

if (!fs.existsSync(DIST)) fs.mkdirSync(DIST);
var imagesDir = path.join(DIST, 'images');
if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir);

fs.writeFileSync(path.join(DIST, 'index.html'), html, 'utf8');

// Clock icon SVG
var svgIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#25477B">' +
  '<path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 ' +
  '11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 ' +
  '3.15.75-1.23-4.5-2.67z"/></svg>';

fs.writeFileSync(path.join(imagesDir, 'icon.svg'), svgIcon, 'utf8');

// ---- Build config.json (cache-busted URL) ----

var config = {
  name: 'ELD Compliance Monitor',
  supportEmail: 'support@example.com',
  version: '1.0.0',
  items: [
    {
      url: baseUrl + '/index.html?v=' + cacheBust,
      path: 'ActivityLink/',
      menuName: {
        en: 'ELD Compliance'
      },
      svgIcon: baseUrl + '/images/icon.svg?v=' + cacheBust
    }
  ],
  isSigned: false
};

// ---- Write config.json ----

fs.writeFileSync(OUT, JSON.stringify(config, null, 2), 'utf8');

var htmlSize = Buffer.byteLength(html, 'utf8');
var configSize = fs.statSync(OUT).size;

console.log('Build complete!');
console.log('  docs/index.html: ' + (htmlSize / 1024).toFixed(1) + ' KB');
console.log('  config.json:     ' + (configSize / 1024).toFixed(1) + ' KB');
console.log('  Cache bust:      v=' + cacheBust);
console.log('  Base URL:        ' + baseUrl);
console.log('');
console.log('Next steps:');
console.log('  1. git add + commit + push');
console.log('  2. In MyGeotab: Administration > System Settings > Add-Ins');
console.log('  3. Add new add-in, paste config.json contents, save');
console.log('  (Each build generates a unique URL so no browser cache issues)');
