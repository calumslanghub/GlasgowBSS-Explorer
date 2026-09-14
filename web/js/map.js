// map.js — Leaflet map: station markers, OD route lines, infrastructure layer.
// Reads global state S (app.js) and DATA (data.js); exposes a small MAP api.
// Lines are drawn from layer specs (manifest `map_lines`), so the same code
// draws outbound/inbound flows (phase 1) and commuter-coloured corridors
// (phase 3) — the view config decides, not bespoke functions.

'use strict';

var MAP = {
  map: null,
  markers: {},        // station id -> L.circleMarker
  lineLayer: null,    // L.layerGroup of route polylines
  infraLayer: null,   // L.geoJSON of cycle infrastructure
  infraFeatures: []   // cached leaflet layers with their `opened` dates
};

function initMap() {
  MAP.map = L.map('map', { zoomControl: false, preferCanvas: true }).setView([55.86, -4.26], 12);
  L.control.zoom({ position: 'topright' }).addTo(MAP.map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · Infra: Glasgow City Council · Trips: nextbike Glasgow',
    maxZoom: 19, opacity: 0.6
  }).addTo(MAP.map);
  MAP.infraLayer = L.layerGroup().addTo(MAP.map);
  MAP.lineLayer = L.layerGroup().addTo(MAP.map);
  buildStationMarkers();
  buildInfraLayer();
}

// ── Stations ──────────────────────────────────────────────────────────────────
function markerRadius(trips) {
  return 4 + Math.sqrt(Math.max(trips, 0)) / 30;
}

function buildStationMarkers() {
  var cols = DATA.manifest.colours.ui;
  stations().forEach(function (s) {
    var m = L.circleMarker([s.lat, s.lon], {
      radius: markerRadius(s.trips), color: '#fff', weight: 1.5, fillColor: cols.station, fillOpacity: 0.85, pane: 'markerPane'
    });
    m.bindTooltip('<div class="station-tip"><b>' + s.id + '</b>' + fmtNum(s.trips) + ' trips · live from ' + fmtDate(s.first_trip) + '</div>', { direction: 'top', offset: [0, -4] });
    m.on('click', function () { selectStation(s.id); });
    m.station = s;
    m.addTo(MAP.map);
    MAP.markers[s.id] = m;
  });
  var b = L.latLngBounds(stations().map(function (s) { return [s.lat, s.lon]; }));
  if (b.isValid()) MAP.map.fitBounds(b.pad(0.05));
}

// Restyle markers for the current state: selection highlight, timeline
// visibility (station appears at its first trip), and dimming.
function styleMarkers() {
  var cols = DATA.manifest.colours.ui;
  var view = DATA.manifest.views[S.view];
  var useTimeline = view.map.timeline;
  Object.keys(MAP.markers).forEach(function (id) {
    var m = MAP.markers[id], s = m.station;
    var live = !useTimeline || s.first_trip <= S.date;
    var selected = id === S.station;
    m.setStyle({
      fillColor: selected ? cols.station_selected : cols.station,
      color: selected ? cols.ink : '#fff',
      weight: selected ? 2 : 1.5,
      fillOpacity: live ? (selected ? 1 : 0.85) : 0,
      opacity: live ? 1 : 0,
      radius: selected ? markerRadius(s.trips) + 3 : markerRadius(s.trips)
    });
    if (selected) m.bringToFront();
    if (live) { if (!m._map) m.addTo(MAP.map); } else if (m._map) { m.remove(); }
  });
}

// ── Route lines ───────────────────────────────────────────────────────────────
// specs: [{layerName, meta}] from the active view's map.lines. Each row of the
// layer's data is a partner station; the polyline follows routes.json.
function drawLines() {
  MAP.lineLayer.clearLayers();
  var view = DATA.manifest.views[S.view];
  if (!S.station || !view.map.lines.length) return;
  var maxTrips = 1;
  var todo = [];
  view.map.lines.forEach(function (name) {
    var meta = DATA.manifest.layers[name];
    var spec = meta.map_lines; if (!spec) return;
    if (spec.role !== 'both' && !S.lines[spec.role]) return;
    var rows = layerData(meta, S) || [];
    rows.forEach(function (r) {
      var a = spec.role === 'destination' ? r.station : S.station;
      var b = spec.role === 'destination' ? S.station : r.station;
      var colour = spec.colour || (spec.colour_map ? spec.colour_map[r[spec.colour_key]] : '#0065bd');
      todo.push({ a: a, b: b, row: r, colour: colour, spec: spec, meta: meta });
      maxTrips = Math.max(maxTrips, r.trips || 0);
    });
  });
  todo.forEach(function (t) {
    var path = routeFor(t.a, t.b);
    if (!path) return;
    var w = 1.5 + 5 * Math.sqrt((t.row.trips || 0) / maxTrips);
    // Inbound and outbound often share the same street, so inbound is dashed
    // to let the outbound line show through the gaps.
    var dash = t.spec.role === 'destination' ? '6 7' : null;
    var line = L.polyline(path, { color: t.colour, weight: w, opacity: 0.8, dashArray: dash, lineCap: 'butt', lineJoin: 'round' });
    var partner = t.row.station;
    var tip = '<b>' + (t.spec.role === 'destination' ? partner + ' → ' + S.station : (t.spec.role === 'origin' ? S.station + ' → ' + partner : S.station + ' ↔ ' + partner)) + '</b><br>' + fmtNum(t.row.trips) + ' trips';
    if (t.row.commuter) tip += ' · ' + t.row.commuter;
    if (t.row.exp_any !== undefined) tip += '<br>' + fmtNum(t.row.exp_any, 0, '%') + ' of route on cycle infrastructure';
    line.bindTooltip(tip, { sticky: true });
    line.on('mouseover', function () { line.setStyle({ opacity: 1, weight: w + 2 }); });
    line.on('mouseout', function () { line.setStyle({ opacity: 0.8, weight: w }); });
    line.on('click', function () { selectStation(partner); });
    line.addTo(MAP.lineLayer);
  });
}

// ── Infrastructure ────────────────────────────────────────────────────────────
function buildInfraLayer() {
  var fc = DATA.files['infra.geojson'];
  var cols = DATA.manifest.colours.infra;
  if (!fc) return;
  var gj = L.geoJSON(fc, {
    style: function (f) { return { color: cols[f.properties.type] || '#999', weight: 2.5, opacity: 0.85 }; },
    onEachFeature: function (f, layer) {
      var p = f.properties;
      layer.bindTooltip('<b>' + (p.name || p.scheme || 'Cycle route') + '</b><br>' + p.type + ' · ' + fmtNum(p.km, 2, ' km') + '<br>' + (p.opened <= DATA.files['infra_timeline.json'].study_start ? 'Open before study start' : 'Opened ' + fmtDate(p.opened)), { sticky: true });
      MAP.infraFeatures.push({ layer: layer, opened: p.opened });
    }
  });
  MAP.infraGeo = gj;
}

function drawInfra() {
  var mode = DATA.manifest.views[S.view].map.infra;
  MAP.infraLayer.clearLayers();
  if (mode === 'none' || !MAP.infraGeo) return;
  var faint = mode === 'all';
  MAP.infraFeatures.forEach(function (f) {
    var show = mode === 'all' ? f.opened <= DATA.manifest.summary.date_end : f.opened <= S.date;
    if (!show) return;
    f.layer.setStyle({ opacity: faint ? 0.45 : 0.9, weight: faint ? 2 : 3 });
    f.layer.addTo(MAP.infraLayer);
  });
  MAP.lineLayer.eachLayer(function (l) { l.bringToFront(); });
}

// ── Legend ────────────────────────────────────────────────────────────────────
function drawLegend() {
  var box = document.getElementById('map-legend');
  clear(box);
  var view = DATA.manifest.views[S.view];
  var cols = DATA.manifest.colours;
  view.map.lines.forEach(function (name) {
    var spec = DATA.manifest.layers[name].map_lines;
    if (!spec) return;
    if (spec.colour_map) {
      Object.keys(spec.colour_map).forEach(function (k) { box.appendChild(el('span', 'lg', '<i style="background:' + spec.colour_map[k] + '"></i>' + k + ' corridor')); });
    } else if (spec.role === 'origin') {
      box.appendChild(el('span', 'lg', '<i style="background:' + spec.colour + '"></i>Outbound (trips start here)'));
    } else if (spec.role === 'destination') {
      box.appendChild(el('span', 'lg', '<i style="background:repeating-linear-gradient(90deg,' + spec.colour + ' 0 5px,transparent 5px 8px)"></i>Inbound (trips end here)'));
    }
  });
  if (view.map.infra !== 'none') {
    Object.keys(cols.infra).forEach(function (k) { box.appendChild(el('span', 'lg', '<i style="background:' + cols.infra[k] + '"></i>' + k)); });
  }
  box.appendChild(el('span', 'lg', '<i class="dot" style="background:' + cols.ui.station + '"></i>station (size = trips)'));
}

// Zoom to the selected station and its drawn routes (falls back to the marker).
function focusStation(id) {
  var m = MAP.markers[id];
  if (!m) return;
  var b = L.latLngBounds([m.getLatLng()]);
  MAP.lineLayer.eachLayer(function (l) { b.extend(l.getBounds()); });
  MAP.map.fitBounds(b.pad(0.15), { maxZoom: 14, animate: true });
}

function updateMap() {
  styleMarkers();
  drawInfra();
  drawLines();
  drawLegend();
  var tg = document.getElementById('line-toggle');
  var view = DATA.manifest.views[S.view];
  var roles = view.map.lines.map(function (n) { return (DATA.manifest.layers[n].map_lines || {}).role; });
  tg.hidden = !(roles.indexOf('origin') >= 0 || roles.indexOf('destination') >= 0);
}
