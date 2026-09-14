// app.js — global state, view tabs, dispatch loop. Loaded last.
//
// The one dispatch rule: for the active view, walk its `layers` list, pick
// RENDERERS[layer.render], hand it the layer's data + meta + state. Adding a
// panel is a manifest entry, not code here.

'use strict';

var S = {
  view: 'flows',        // active tab (manifest views key)
  station: null,        // selected station id
  date: null,           // timeline date (ISO) — phase 2
  lines: { origin: true, destination: true }   // phase 1 line toggles
};

var PANELS = [];        // live renderer handles for the current view

function init() {
  loadAll().then(function () {
    buildHeader();
    initMap();
    initTimeline();
    buildStationSelect();
    wireLineToggle();
    var first = stations().slice().sort(function (a, b) { return b.trips - a.trips; })[0];
    var h = readHash();
    if (h.date && TL.dates.indexOf(h.date) >= 0) setDate(h.date, true);
    setView(h.view && DATA.manifest.views[h.view] ? h.view : S.view);
    var wanted = h.station && stations().some(function (s) { return s.id === h.station; }) ? h.station : (first && first.id);
    if (wanted) selectStation(wanted);
    window.addEventListener('hashchange', onHashChange);
  }).catch(function (err) {
    document.getElementById('panel-body').innerHTML = '<div class="card-empty">Could not load data: ' + err.message + '</div>';
    console.error(err);
  });
}

// ── Header: summary tiles + view tabs ─────────────────────────────────────────
function buildHeader() {
  var s = DATA.manifest.summary;
  var tiles = document.getElementById('summary-tiles');
  [
    [fmtNum(s.trips), 'trips'],
    [fmtNum(s.stations), 'stations'],
    [fmtNum(s.infra_km, 0, ' km'), 'cycle infra'],
    [fmtNum(s.commuter_pct, 0, '%'), 'commuter trips'],
    [fmtNum(s.exp_any_pct, 0, '%'), 'route on infra']
  ].forEach(function (t) { tiles.appendChild(el('div', 'sum-tile', '<b>' + t[0] + '</b><span>' + t[1] + '</span>')); });

  var tabs = document.getElementById('view-tabs');
  Object.keys(DATA.manifest.views).forEach(function (key) {
    var v = DATA.manifest.views[key];
    var b = el('button', 'view-tab', '<span class="phase">' + v.phase + '</span>' + v.title);
    b.type = 'button'; b.dataset.view = key;
    b.addEventListener('click', function () { setView(key); });
    tabs.appendChild(b);
  });
  var foot = document.getElementById('foot-text');
  foot.innerHTML = 'Trips ' + fmtDate(s.date_start) + ' to ' + fmtDate(s.date_end) + ' · routes: ' +
    (s.router === 'osmnx' ? 'shortest bike-network path (OSMnx)' : 'straight lines') +
    ' · MSc dissertation, University of Glasgow.';
}

function buildStationSelect() {
  var sel = document.getElementById('station-select');
  clear(sel);
  var ph = el('option', '', 'Select a station…'); ph.value = ''; sel.appendChild(ph);
  stations().slice().sort(function (a, b) { return a.id.localeCompare(b.id); }).forEach(function (s) {
    var o = el('option', '', s.id + ' (' + fmtNum(s.trips) + ')'); o.value = s.id; sel.appendChild(o);
  });
  sel.addEventListener('change', function () { if (sel.value) selectStation(sel.value); });
}

function wireLineToggle() {
  var cols = DATA.manifest.colours.roles;
  document.querySelectorAll('#line-toggle button').forEach(function (b) {
    var role = b.dataset.lines;
    b.insertAdjacentHTML('afterbegin', '<i class="swatch" style="background:' + cols[role] + '"></i>');
    b.addEventListener('click', function () {
      S.lines[role] = !S.lines[role];
      b.classList.toggle('active', S.lines[role]);
      drawLines();
    });
  });
}

// ── URL hash (shareable links: #view=timeline&station=...&date=...) ──────────
function readHash() {
  var p = new URLSearchParams(location.hash.replace(/^#/, ''));
  return { view: p.get('view'), station: p.get('station'), date: p.get('date') };
}

function writeHash() {
  var p = new URLSearchParams();
  p.set('view', S.view);
  if (S.station) p.set('station', S.station);
  if (S.view === 'timeline' && S.date) p.set('date', S.date);
  var next = '#' + p.toString();
  if (location.hash !== next) history.replaceState(null, '', next);
}

function onHashChange() {
  var h = readHash();
  if (h.view && h.view !== S.view && DATA.manifest.views[h.view]) setView(h.view);
  if (h.station && h.station !== S.station && stations().some(function (s) { return s.id === h.station; })) selectStation(h.station);
}

// ── State transitions ─────────────────────────────────────────────────────────
function setView(key) {
  S.view = key;
  document.querySelectorAll('.view-tab').forEach(function (b) { b.classList.toggle('active', b.dataset.view === key); });
  var view = DATA.manifest.views[key];
  document.getElementById('timeline').hidden = !view.map.timeline;
  if (!view.map.timeline && TL.timer) stopPlay();
  renderPanels();
  updateMap();
  writeHash();
}

function selectStation(id) {
  S.station = id;
  document.getElementById('station-select').value = id;
  renderPanels();
  updateMap();
  focusStation(id);
  writeHash();
}

// Slider moved: cheap in-place refresh (marker visibility, infra filter,
// chart marker, KPI values) — no chart rebuilds.
function refreshForDate() {
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
  var needsStation = view.layers.some(function (n) { return DATA.manifest.layers[n].scope === 'station'; });
  if (needsStation && !S.station) {
    head.textContent = 'Select a station';
    hint.textContent = 'Click a marker on the map, or pick a station from the list.';
    return;
  }
  var st = stations().find(function (s) { return s.id === S.station; });
  head.textContent = needsStation ? S.station : view.title;
  hint.textContent = needsStation && st
    ? fmtNum(st.trips) + ' trips · live from ' + fmtDate(st.first_trip) + ' · ' + viewHint(view)
    : viewHint(view);
  var body = document.getElementById('panel-body');
  view.layers.forEach(function (name) {
    var meta = Object.assign({ __name: name }, DATA.manifest.layers[name]);
    var fn = RENDERERS[meta.render];
    if (!fn) { console.warn('No renderer for', meta.render); return; }
    PANELS.push(fn(body, layerData(meta, S), meta, S));
  });
}

function viewHint(view) {
  if (view.phase === 1) return 'lines on the map follow the shortest bike-network route';
  if (view.phase === 2) return 'drag the slider or press play; stations appear at their first trip';
  return 'corridor colours show the k-means commuter label from the dissertation';
}

document.addEventListener('DOMContentLoaded', init);
