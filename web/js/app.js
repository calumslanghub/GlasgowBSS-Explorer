// app.js — global state, view tabs, dispatch loop. Loaded last.
//
// The one dispatch rule: for the active view, walk its `layers` list, pick
// RENDERERS[layer.render], hand it the layer's data + meta + state. Adding a
// panel is a manifest entry, not code here.

'use strict';

var S = {
  view: 'flows',        // active tab (manifest views key)
  station: null,        // selected station id (null = none)
  date: null,           // timeline date (ISO) — phase 2
  hour: null,           // standard-day hour (6-23) — phase 1; null = all-day
  seg_mode: 'all',      // 'all' | 'commuter' — phase 4
  show: {               // legend toggles
    origin: true, destination: true, stations: true,
    infra: { segregated: true, lane: true, shared: true, mixed: true },
    corridor: { commuter: true, 'non-commuter': true, unclassified: false }
  }
};

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
    if (h.seg === 'commuter') S.seg_mode = 'commuter';
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
function readHash() {
  var p = new URLSearchParams(location.hash.replace(/^#/, ''));
  var hour = p.get('hour');
  return {
    view: p.get('view'), station: p.get('station'), date: p.get('date'),
    hour: hour !== null && hour !== '' ? +hour : null, seg: p.get('seg')
  };
}

function writeHash() {
  var p = new URLSearchParams();
  p.set('view', S.view);
  if (S.station) p.set('station', S.station);
  if (S.view === 'timeline' && S.date) p.set('date', S.date);
  if (S.view === 'flows' && S.hour !== null) p.set('hour', S.hour);
  if (S.view === 'segregated' && S.seg_mode !== 'all') p.set('seg', S.seg_mode);
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
  setTimelineMode(view.map.timeline || 'none');
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

function setSegMode(mode) {
  S.seg_mode = mode;
  renderPanels();
  updateMap();
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
    ? fmtNum(st.trips) + ' trips · live from ' + fmtDate(st.first_trip) + ' · ' + viewHint(view)
    : viewHint(view);
  var skipped = 0;
  view.layers.forEach(function (name) {
    var meta = DATA.manifest.layers[name];
    if (meta.scope === 'station' && !S.station) { skipped++; return; }
    var fn = RENDERERS[meta.render];
    if (!fn) { console.warn('No renderer for', meta.render); return; }
    PANELS.push(fn(body, layerData(meta, S), meta, S));
  });
  if (skipped) {
    body.appendChild(el('div', 'card-prompt', 'Click a station on the map, or pick one from the list, to see its ' +
      (view.phase === 1 ? 'top destinations, origins and hourly split.' : view.phase === 3 ? 'busiest corridors and neighbourhood profile.' : 'infrastructure exposure.')));
  }
}

function viewHint(view) {
  if (view.phase === 1) return 'lines follow the shortest bike-network route; press play for a standard day';
  if (view.phase === 2) return 'drag the slider or press play; stations appear at their first trip';
  if (view.phase === 3) return S.station ? 'corridor colours show the k-means commuter label' : 'street width = trips on that street across all corridors';
  return 'click a segment for its trip counts; switch to commuter corridors in the legend';
}

document.addEventListener('DOMContentLoaded', init);
