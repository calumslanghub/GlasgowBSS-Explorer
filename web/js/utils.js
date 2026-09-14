// utils.js — small shared helpers: colours, formatting, DOM, Chart.js defaults.
// Loaded first; every other file may use these globals.

'use strict';

function hexAlpha(hex, a) {
  var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
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
function makeCard(meta) {
  var card = el('div', 'card');
  var head = el('div', 'card-head');
  head.appendChild(el('div', 'card-title', meta.title || ''));
  if (meta.subtitle) head.appendChild(el('div', 'card-sub', meta.subtitle));
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
