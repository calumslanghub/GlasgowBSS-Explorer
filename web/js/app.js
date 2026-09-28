// app.js — the page: sections, shared state, dispatch. Loaded last.
//
// The site is ONE scrolling page. Every manifest `views` entry is a section:
//   heading -> text layers -> map + side panel -> optional wide chart grid.
// Each section owns its own Leaflet map, timeline, selected station and
// legend toggles; controls (day type, buffer, census variable, ...) are shared
// page-wide, so changing the buffer in one section updates every section that
// uses it.
//
// The one dispatch rule is unchanged: for a section, walk its layer lists,
// pick RENDERERS[layer.render] and hand it the layer's data + meta + state.
// Adding a panel is a manifest entry, not code here.
//
// Section context: map.js, timeline.js and the renderers were written against
// one map and one state object. Rather than thread a section argument through
// every function, the active section is held in SEC (and its map in MAP) while
// code for it runs — inSec(sec, fn) sets both — and S is a Proxy that reads
// the section-local keys (station, show, pairs, fixed overrides) from SEC.

'use strict';

// Page-wide state (shared controls). Section-local keys live on the section.
var STATE = {
  date: null,           // timeline date (ISO) — cycle infrastructure
  hour: null,           // standard-day hour (6-23) — station flows; null = all-day
  daytype: 'all',       // 'all' | 'weekday' | 'weekend'
  census_var: 'avg_age',// choropleth variable
  buffer: '250',        // buffer radius (m)
  seg_mode: 'all'       // 'all' | 'commuter' — segregated usage map
};
var DEFAULT_SHOW = {
  origin: true, destination: true, stations: true, heat: false, oa: true,
  infra: { segregated: true, lane: true, shared: true, mixed: true },
  corridor: { commuter: true, 'non-commuter': true }
};
var LOCAL_KEYS = { station: 1, show: 1, pairs: 1, focusPair: 1 };

var SEC = null;         // the section whose code is running
var SECTIONS = [];      // every section, in page order
var SEC_BY_KEY = {};

var S = new Proxy(STATE, {
  get: function (t, k) {
    if (SEC) {
      if (k === 'view') return SEC.key;
      if (LOCAL_KEYS[k]) return SEC[k];
      if (SEC.fixed && Object.prototype.hasOwnProperty.call(SEC.fixed, k)) return SEC.fixed[k];
    }
    return t[k];
  },
  set: function (t, k, v) {
    if (k === 'view') return true;
    if (SEC && LOCAL_KEYS[k]) { SEC[k] = v; return true; }
    t[k] = v;
    return true;
  }
});

// Run fn with `sec` as the active section (restores the previous one).
function inSec(sec, fn) {
  var prevS = SEC, prevM = MAP;
  SEC = sec; MAP = sec ? sec.m : null;
  try { return fn(); } finally { SEC = prevS; MAP = prevM; }
}
// Wrap a handler so it always runs in the section that created it.
function bindSec(fn) {
  var sec = SEC;
  return function () { var self = this, args = arguments; return inSec(sec, function () { return fn.apply(self, args); }); };
}
// An element of the active section, by its data-el name.
function secEl(name) { return SEC ? SEC.root.querySelector('[data-el="' + name + '"]') : null; }

function init() {
  loadAll().then(function () {
    buildHero();
    buildSections();
    buildNav();
    lazyInit();
  }).catch(function (err) {
    document.getElementById('hero-text').innerHTML = '<span class="load-error">Could not load data: ' + err.message + '</span>';
    console.error(err);
  });
}

// ── Hero: title, intro paragraph, headline numbers ───────────────────────────
function fillSummary(str) {
  return String(str || '').replace(/\{summary\.(\w+)\}/g, function (m, k) {
    var v = (DATA.manifest.summary || {})[k];
    return v === undefined ? m : (typeof v === 'number' ? fmtNum(v) : String(v));
  });
}

function buildHero() {
  var page = DATA.manifest.page || {};
  document.getElementById('hero-title').textContent = page.title || document.title;
  document.getElementById('hero-sub').textContent = page.subtitle || '';
  document.getElementById('hero-text').innerHTML = fillSummary(page.intro);
  var box = document.getElementById('hero-kpis');
  clear(box);
  (page.headline || []).forEach(function (h) {
    var root = h.file === 'manifest' ? DATA.manifest.summary : DATA.files[h.file];
    var v = h.key ? (root || {})[h.key] : (h.path || []).reduce(function (n, k) { return n ? n[k] : null; }, root);
    var tile = el('div', 'hero-kpi');
    tile.appendChild(el('b', '', fmtNum(v, h.dp, h.unit)));
    tile.appendChild(el('span', '', h.label));
    box.appendChild(tile);
  });
  var s = DATA.manifest.summary;
  document.getElementById('foot-text').innerHTML = 'Trips ' + fmtDate(s.date_start) + ' to ' + fmtDate(s.date_end) + ' · routes: ' +
    (s.router === 'osmnx' ? 'shortest bike-network path (OSMnx)' : 'straight lines') +
    ' · MSc Urban Analytics dissertation, University of Glasgow.' +
    '<br>Data: nextbike Glasgow via Cycling Scotland (trips) · Glasgow City Council (cycle infrastructure) · NRS Census 2022 · Glasgow Licensing Board (premises) · basemap © Esri, © OpenStreetMap contributors.';
}

// ── Sections ─────────────────────────────────────────────────────────────────
function buildSections() {
  var host = document.getElementById('sections');
  var tpl = document.getElementById('tpl-section');
  var groups = (DATA.manifest.page || {}).groups || {};
  var lastGroup = null;
  Object.keys(DATA.manifest.views).forEach(function (key) {
    var v = DATA.manifest.views[key];
    if (v.group && v.group !== lastGroup && groups[v.group]) {
      var g = groups[v.group];
      var gh = el('div', 'group-head');
      gh.id = v.group;
      gh.appendChild(el('h2', 'sec-title', '<span class="sec-num">' + (g.number || '') + '</span>' + g.title));
      if (g.body) gh.appendChild(el('p', 'group-text', fillSummary(g.body)));
      host.appendChild(gh);
    }
    lastGroup = v.group || null;
    var root = tpl.content.firstElementChild.cloneNode(true);
    root.id = key;
    root.classList.add('layout-' + (v.layout || 'map'));
    if (v.group) root.classList.add('in-group');
    host.appendChild(root);
    var show = JSON.parse(JSON.stringify(DEFAULT_SHOW));
    Object.keys(v.show || {}).forEach(function (k) { show[k] = v.show[k]; });
    var sec = {
      key: key, view: v, root: root, fixed: v.fixed || null,
      station: null, show: show, pairs: [], focusPair: null,
      m: null, tl: null, panels: [], wide: [], ready: false
    };
    SECTIONS.push(sec); SEC_BY_KEY[key] = sec;
    inSec(sec, function () {
      var h = secEl('title');
      var html = '<span class="sec-num">' + (v.number || '') + '</span>' + v.title;
      if (v.group) {
        var h3 = el('h3', 'sec-title sub', html);
        h3.dataset.el = 'title';
        h.replaceWith(h3);
      } else {
        h.innerHTML = html;
      }
      secEl('map-title').textContent = v.map_title || '';
      secEl('map-title').hidden = !v.map_title;
      root.classList.toggle('wide-first', !!v.wide_first);
      renderText();
    });
  });
}

// Sections build their maps and charts only when they come near the viewport,
// so the first paint is the intro rather than seven Leaflet maps at once.
function lazyInit() {
  var start = function (sec) { if (!sec.ready) inSec(sec, initSection); };
  if (!('IntersectionObserver' in window)) { SECTIONS.forEach(start); return; }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      var sec = SEC_BY_KEY[e.target.id];
      if (sec) { start(sec); io.unobserve(e.target); }
    });
  }, { rootMargin: '600px 0px' });
  SECTIONS.forEach(function (sec) { io.observe(sec.root); });
}

function initSection() {
  var sec = SEC;
  sec.ready = true;
  var view = sec.view;
  initMap(secEl('map'));
  initTimeline();
  buildStationSelect();
  secEl('station-picker').hidden = view.map.select === false;
  setTimelineMode(view.map.timeline || 'none');
  if (view.scatter) renderScatter();
  renderWide();
  renderPanels();
  updateMap();
  if (view.map.stations === 'bars') fitStations();
}

function buildStationSelect() {
  var sel = secEl('station-select');
  clear(sel);
  var ph = el('option', '', 'All stations (none selected)'); ph.value = ''; sel.appendChild(ph);
  stations().slice().sort(function (a, b) { return a.id.localeCompare(b.id); }).forEach(function (s) {
    var o = el('option', '', s.id + ' (' + fmtNum(s.trips) + ')'); o.value = s.id; sel.appendChild(o);
  });
  sel.addEventListener('change', bindSec(function () { selectStation(sel.value || null); }));
}

// ── Navigation: one link per top-level section (groups collapse to one) ──────
function buildNav() {
  var nav = document.getElementById('nav');
  var groups = (DATA.manifest.page || {}).groups || {};
  var seen = {};
  var links = [];
  SECTIONS.forEach(function (sec) {
    var v = sec.view;
    var id = v.group || sec.key;
    if (seen[id]) return;
    seen[id] = 1;
    var g = v.group ? groups[v.group] : null;
    var a = el('a', 'nav-link', '<span class="sec-num">' + ((g || v).number || '') + '</span>' + (g || v).title);
    a.href = '#' + id;
    a.dataset.target = id;
    nav.appendChild(a);
    links.push(a);
  });
  if (!('IntersectionObserver' in window)) return;
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      var sec = SEC_BY_KEY[e.target.id];
      var id = sec ? (sec.view.group || sec.key) : e.target.id;
      links.forEach(function (a) { a.classList.toggle('active', a.dataset.target === id); });
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  SECTIONS.forEach(function (sec) { io.observe(sec.root); });
}

// ── State transitions ─────────────────────────────────────────────────────────
// A legend control changed (day type, census variable, buffer, ...). Controls
// are page-wide, so every built section that lists a control on the same
// state key refreshes; a section whose `fixed` pins that key is unaffected.
function setControl(stateKey, value) {
  STATE[stateKey] = value;
  SECTIONS.forEach(function (sec) {
    if (!sec.ready) return;
    var uses = (sec.view.controls || []).some(function (n) { return DATA.manifest.controls[n].state === stateKey; });
    if (uses) inSec(sec, refreshSection);
  });
}

function refreshSection() {
  renderText();
  renderPanels();
  updateMap();
  if (TL_MODES[SEC.tl.mode] && SEC.tl.mode === 'hours') showTimelineLabel();
}

// id = null clears the selection (panels, lines, marker highlight). In the
// corridor section a station picks every clustered pair that uses it.
function selectStation(id) {
  S.station = id || null;
  secEl('station-select').value = S.station || '';
  if (SEC.view.scatter) {
    setPairs(S.station ? scatterRows().filter(function (r) { return r.a === S.station || r.b === S.station; }) : [], true);
    return;
  }
  renderPanels();
  updateMap();
  if (S.station) focusStation(S.station);
}

// Selected k-means pairs (from the scatter, the sliders or a station click).
function setPairs(rows, fromStation) {
  S.pairs = rows || [];
  S.focusPair = null;
  if (!fromStation && S.station) { S.station = null; secEl('station-select').value = ''; }
  if (SEC.scatter && SEC.scatter.highlight) SEC.scatter.highlight(S.pairs);
  renderPanels();
  updateMap();
  fitPairs();
}
function focusPair(row) {
  S.focusPair = row;
  if (SEC.scatter && SEC.scatter.highlight) SEC.scatter.highlight(S.pairs, row);
  updateMap();
  fitPairs(row);
}
function scatterRows() {
  var meta = DATA.manifest.layers[SEC.view.scatter];
  return layerData(meta, S) || [];
}

// Slider moved (date or hour): cheap in-place refresh — no chart rebuilds.
function refreshForSlider() {
  styleMarkers();
  drawInfra();
  SEC.panels.forEach(function (p) { if (p && p.update) p.update(S); });
}

// ── Dispatch ──────────────────────────────────────────────────────────────────
function renderLayers(names, body, handles) {
  var skipped = 0;
  (names || []).forEach(function (name) {
    var meta = DATA.manifest.layers[name];
    if (meta.scope === 'station' && !S.station) { skipped++; return; }
    if (!showIf(meta.show_if, S)) return;
    var fn = RENDERERS[meta.render];
    if (!fn) { console.warn('No renderer for', meta.render); return; }
    handles.push(fn(body, layerData(meta, S), meta, S));
  });
  return skipped;
}

function destroy(handles) {
  handles.forEach(function (p) { if (p && p.chart) p.chart.destroy(); });
  handles.length = 0;
}

// Section text (above the map): re-rendered when a control changes so any
// {census_var}-style placeholders follow it.
function renderText() {
  var box = secEl('text');
  clear(box);
  renderLayers(SEC.view.text, box, []);
}

function renderWide() {
  var box = secEl('wide');
  destroy(SEC.wide);
  clear(box);
  renderLayers(SEC.view.wide, box, SEC.wide);
  box.hidden = !box.childNodes.length;
}

function renderScatter() {
  var meta = DATA.manifest.layers[SEC.view.scatter];
  SEC.scatter = RENDERERS.scatter(secEl('scatter'), layerData(meta, S), meta, S);
}

function renderPanels() {
  destroy(SEC.panels);
  var view = SEC.view;
  var body = secEl('panel-body');
  clear(body);
  var st = S.station ? stationById(S.station) : null;
  secEl('panel-station').textContent = st ? S.station : (view.panel_title || 'Across the network');
  secEl('panel-hint').textContent = st
    ? fmtNum(st.trips) + ' trips · live from ' + fmtDate(st.first_trip)
    : (view.hint || '');
  var skipped = renderLayers(view.layers, body, SEC.panels);
  if (skipped && view.prompt && view.map.select !== false) {
    body.insertBefore(el('div', 'card-prompt', view.prompt), body.firstChild);
  }
}

document.addEventListener('DOMContentLoaded', init);
