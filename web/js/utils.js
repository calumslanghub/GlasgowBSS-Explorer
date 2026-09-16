// utils.js — small shared helpers: colours, formatting, DOM, Chart.js defaults.
// Loaded first; every other file may use these globals.

'use strict';

function hexAlpha(hex, a) {
  var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}

function hexToRgb(hex) {
  hex = hex.replace('#', '');
  return [parseInt(hex.substr(0, 2), 16), parseInt(hex.substr(2, 2), 16), parseInt(hex.substr(4, 2), 16)];
}
function rgbToHex(rgb) {
  return '#' + rgb.map(function (v) { return Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0'); }).join('');
}
// Linear blend between two hex colours; t = 0 gives c1, t = 1 gives c2.
function lerpColor(c1, c2, t) {
  var a = hexToRgb(c1), b = hexToRgb(c2);
  return rgbToHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}

// Number formatting: thousands separators, fixed decimals, optional unit.
function fmtNum(v, dp, unit) {
  if (v === null || v === undefined || Number.isNaN(v)) return '–';
  var n = Number(v);
  var s = n.toLocaleString('en-GB', { minimumFractionDigits: dp || 0, maximumFractionDigits: dp || 0 });
  return s + (unit || '');
}

function fmtDate(iso) {
  var d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function fmtMonth(iso) {
  var d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// Shorten long station names for axis labels.
function shortName(name, max) {
  max = max || 26;
  var s = String(name).replace(' - ELECTRIC', ' (E)').replace('Railway Station', 'Rail Stn');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function el(tag, cls, html) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

// Card scaffold used by every renderer: title/subtitle + a body element.
function makeCard(meta, state) {
  var card = el('div', 'card');
  var head = el('div', 'card-head');
  head.appendChild(el('div', 'card-title', fmtTitle(meta.title || '', state)));
  if (meta.subtitle) head.appendChild(el('div', 'card-sub', fmtTitle(meta.subtitle, state)));
  card.appendChild(head);
  var body = el('div', 'card-body');
  card.appendChild(body);
  return { card: card, body: body };
}

// Chart.js global defaults so every chart shares one look.
if (window.Chart) {
  Chart.defaults.font.family = "'Roboto', system-ui, sans-serif";
  Chart.defaults.font.size = 11;
  Chart.defaults.color = '#5e5e5e';
  Chart.defaults.plugins.legend.labels.boxWidth = 12;
  Chart.defaults.plugins.legend.labels.padding = 10;
  Chart.defaults.animation.duration = 250;
}

// Binary search: index of the last element of sorted array `arr` that is <= v.
function lastIndexLE(arr, v) {
  var lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi) {
    var mid = (lo + hi) >> 1;
    if (arr[mid] <= v) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return ans;
}
