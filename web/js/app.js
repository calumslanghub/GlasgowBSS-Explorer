// app.js — global state, view tabs, dispatch loop. Loaded last.
//
// The one dispatch rule: for the active view, walk its `layers` list, pick
// RENDERERS[layer.render], hand it the layer's data + meta + state. Adding a
// panel is a manifest entry, not code here.

'use strict';

var S = {
  view: 'flows',        // active tab (manifest views key)
  station: null,        // selected station id (null = none)
  date: null,           // timeline date (ISO) — cycle infrastructure
  hour: null,           // standard-day hour (6-23) — station flows; null = all-day
  daytype: 'all',       // 'all' | 'weekday' | 'weekend' — station flows
  nbhd_mode: 'buffers', // 'buffers' | 'bars' — neighbourhoods
  census_var: 'avg_age',// choropleth variable — neighbourhoods
  buffer: '250',        // buffer radius (m) — neighbourhoods
  seg_mode: 'all',      // 'all' | 'commuter' — regression map
  show: {               // legend toggles
    origin: true, destination: true, stations: true, heat: false,
    infra: { segregated: true, lane: true, shared: true, mixed: true },
    corridor: { commuter: true, 'non-commuter': true }
  }
};
var DEFAULTS = JSON.parse(JSON.stringify(S));   // for shareable-link hashes

var PANELS = [];        // live renderer handles for the current view

function init() {
  loadAll().then(function () {
    buildHeader();
    initMap();
    initTimeline();
    buildStationSelect();
    var h = readHash();
    if (h.date && TL_MODES.dates.values().indexOf(h.date) >= 0) S.date = h.date;
    var wanted = h.station && stationById(h.station) ? h.station : null;
    S.station = wanted;
    applyHashControls(h.params);
    syncHeat();
    setView(h.view && DATA.manifest.views[h.view] ? h.view : S.view);
    if (S.view === 'flows' && h.hour !== null && h.hour >= 6 && h.hour <= 23) setPosition(h.hour - 6);
    if (wanted) focusStation(wanted);
    window.addEventListener('hashchange', onHashChange);
  }).catch(function (err) {
    document.getElementById('panel-body').innerHTML = '<div class="card-empty">Could not load data: ' + err.message + '</div>';
    console.error(err);
  });
}

// ── Header: view tabs ─────────────────────────────────────────────────────────
function buildHeader() {
  var s = DATA.manifest.summary;
  var tabs = document.getElementById('view-tabs');
  Object.keys(DATA.manifest.views).forEach(function (key) {
    var v = DATA.manifest.views[key];
    var b = el('button', 'view-tab', '<span class="phase">' + v.phase + '</span>' + v.title);
    b.title = 'Page ' + v.phase + ': ' + v.title;
    b.type = 'button'; b.dataset.view = key;
    b.addEventListener('click', function () { setView(key); });
    tabs.appendChild(b);
  });
  document.getElementById('foot-text').innerHTML = 'Trips ' + fmtDate(s.date_start) + ' to ' + fmtDate(s.date_end) + ' · routes: ' +
    (s.router === 'osmnx' ? 'shortest bike-network path (OSMnx)' : 'straight lines') +
    ' · MSc dissertation, University of Glasgow.';
}

function buildStationSelect() {
  var sel = document.getElementById('station-select');
  clear(sel);
  var ph = el('option', '', 'All stations (none selected)'); ph.value = ''; sel.appendChild(ph);
  stations().slice().sort(function (a, b) { return a.id.localeCompare(b.id); }).forEach(function (s) {
    var o = el('option', '', s.id + ' (' + fmtNum(s.trips) + ')'); o.value = s.id; sel.appendChild(o);
  });
  sel.addEventListener('change', function () { selectStation(sel.value || null); });
}

// ── URL hash (shareable links: #view=timeline&station=...&date=...) ──────────
// Controls declare their own hash key in the manifest, so this stays generic.
function readHash() {
  var p = new URLSearchParams(location.hash.replace(/^#/, ''));
  var hour = p.get('hour');
  return {
    view: p.get('view'), station: p.get('station'), date: p.get('date'),
    hour: hour !== null && hour !== '' ? +hour : null, params: p
  };
}

function applyHashControls(p) {
  var cs = DATA.manifest.controls || {};
  Object.keys(cs).forEach(function (name) {
    var ctrl = cs[name];
    var v = ctrl.hash ? p.get(ctrl.hash) : null;
    if (v === null) return;
    if (controlOptions(ctrl).some(function (o) { return o.value === v; })) S[ctrl.state] = v;
  });
}

function writeHash() {
  var p = new URLSearchParams();
  p.set('view', S.view);
  if (S.station) p.set('station', S.station);
  if (S.view === 'timeline' && S.date) p.set('date', S.date);
  if (S.view === 'flows' && S.hour !== null) p.set('hour', S.hour);
  var view = DATA.manifest.views[S.view];
  (view.controls || []).forEach(function (name) {
    var ctrl = DATA.manifest.controls[name];
    if (ctrl.hash && String(S[ctrl.state]) !== String(DEFAULTS[ctrl.state])) p.set(ctrl.hash, S[ctrl.state]);
  });
  var next = '#' + p.toString();
  if (location.hash !== next) history.replaceState(null, '', next);
}

function onHashChange() {
  var h = readHash();
  if (h.view && h.view !== S.view && DATA.manifest.views[h.view]) setView(h.view);
  var st = h.station && stationById(h.station) ? h.station : null;
  if (st !== S.station) selectStation(st);
}

// ── State transitions ─────────────────────────────────────────────────────────
function setView(key) {
  S.view = key;
  document.querySelectorAll('.view-tab').forEach(function (b) { b.classList.toggle('active', b.dataset.view === key); });
  var view = DATA.manifest.views[key];
  var selectable = view.map.select !== false;
  // A station can only be selected where selecting one does something.
  document.getElementById('station-picker').hidden = !selectable;
  if (!selectable && S.station) {
    S.station = null;
    document.getElementById('station-select').value = '';
  }
  setTimelineMode(view.map.timeline || 'none');
  renderPanels();
  updateMap();
  writeHash();
}

// Choosing a licensed-premises variable switches the premises heat map on.
function syncHeat() {
  if (censusVarMeta().heat) S.show.heat = true;
}

// A legend control changed (day type, census variable, buffer, ...).
function setControl(stateKey, value) {
  S[stateKey] = value;
  if (stateKey === 'census_var') syncHeat();
  renderPanels();
  updateMap();
  writeHash();
}

// id = null clears the selection everywhere (panels, lines, marker highlight).
function selectStation(id) {
  S.station = id || null;
  document.getElementById('station-select').value = S.station || '';
  renderPanels();
  updateMap();
  if (S.station) focusStation(S.station);
  writeHash();
}

// Slider moved (date or hour): cheap in-place refresh — no chart rebuilds.
function refreshForSlider() {
  styleMarkers();
  drawInfra();
  PANELS.forEach(function (p) { if (p && p.update) p.update(S); });
  if (!TL.timer) writeHash();
}

// ── Dispatch ──────────────────────────────────────────────────────────────────
function destroyPanels() {
  PANELS.forEach(function (p) { if (p && p.chart) p.chart.destroy(); });
  PANELS = [];
  clear(document.getElementById('panel-body'));
}

function renderPanels() {
  destroyPanels();
  var view = DATA.manifest.views[S.view];
  var head = document.getElementById('panel-station');
  var hint = document.getElementById('panel-hint');
  var body = document.getElementById('panel-body');
  var st = S.station ? stationById(S.station) : null;
  head.textContent = st ? S.station : view.title;
  hint.textContent = st
    ? fmtNum(st.trips) + ' trips · live from ' + fmtDate(st.first_trip) + ' · ' + (view.hint || '')
    : (view.hint || '');
  var skipped = 0;
  view.layers.forEach(function (name) {
    var meta = DATA.manifest.layers[name];
    if (meta.scope === 'station' && !S.station) { skipped++; return; }
    if (!showIf(meta.show_if, S)) return;
    var fn = RENDERERS[meta.render];
    if (!fn) { console.warn('No renderer for', meta.render); return; }
    PANELS.push(fn(body, layerData(meta, S), meta, S));
  });
  if (skipped && view.prompt && view.map.select !== false) {
    body.appendChild(el('div', 'card-prompt', view.prompt));
  }
}

document.addEventListener('DOMContentLoaded', init);
