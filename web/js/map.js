// map.js — Leaflet map: station markers, OD route lines, corridor flow map,
// infrastructure layers and the click-to-toggle legend.
// Reads global state S (app.js) and DATA (data.js); exposes a small MAP api.
// Everything the map draws is decided by the active view's `map` + `legend`
// config in the manifest, so a new overlay is a config entry, not new code.

'use strict';

var MAP = {
  map: null,
  markers: {},        // station id -> L.circleMarker
  lineLayer: null,    // selected station's route polylines
  loadLayer: null,    // city-wide corridor flow map
  infraLayer: null,   // cycle infrastructure (all / timeline / segregated)
  infraFeatures: [],  // cached leaflet layers from infra.geojson
  segFeatures: []     // cached leaflet layers from segregated.geojson
};

var DOT_RADIUS = 5;

function initMap() {
  MAP.map = L.map('map', { zoomControl: false, preferCanvas: true }).setView([55.86, -4.26], 12);
  L.control.zoom({ position: 'topright' }).addTo(MAP.map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · Infra: Glasgow City Council · Trips: nextbike Glasgow',
    maxZoom: 19, opacity: 0.6
  }).addTo(MAP.map);
  MAP.infraLayer = L.layerGroup().addTo(MAP.map);
  MAP.loadLayer = L.layerGroup().addTo(MAP.map);
  MAP.lineLayer = L.layerGroup().addTo(MAP.map);
  buildStationMarkers();
  buildInfraLayer();
  buildSegregatedLayer();
  // Clicking empty map deselects; feature clicks stop propagation.
  MAP.map.on('click', function () { if (S.station) selectStation(null); });
}

// ── Stations ──────────────────────────────────────────────────────────────────
function sizedRadius(trips) { return 4 + Math.sqrt(Math.max(trips, 0)) / 30; }
function hourRadius(trips) { return 3 + 16 * Math.sqrt(Math.max(trips, 0) / DATA.hourlyMax); }

function buildStationMarkers() {
  var cols = DATA.manifest.colours.ui;
  stations().forEach(function (s) {
    var m = L.circleMarker([s.lat, s.lon], {
      radius: DOT_RADIUS, color: '#fff', weight: 1.5, fillColor: cols.station, fillOpacity: 0.85
    });
    m.bindTooltip(function () { return stationTip(s); }, { direction: 'top', offset: [0, -4] });
    m.on('click', function (e) { L.DomEvent.stopPropagation(e); selectStation(s.id); });
    m.station = s;
    m.addTo(MAP.map);
    MAP.markers[s.id] = m;
  });
  var b = L.latLngBounds(stations().map(function (s) { return [s.lat, s.lon]; }));
  if (b.isValid()) MAP.map.fitBounds(b.pad(0.05));
}

function stationTip(s) {
  var html = '<div class="station-tip"><b>' + s.id + '</b>';
  if (S.hour !== null && S.hour !== undefined) {
    var h = hourlyFor(s.id, S.hour) || { out: 0, in: 0 };
    html += fmtNum(h.out) + ' starting · ' + fmtNum(h.in) + ' ending at ' + S.hour + ':00';
  } else {
    html += fmtNum(s.trips) + ' trips · live from ' + fmtDate(s.first_trip);
  }
  return html + '</div>';
}

// Restyle markers for the current state: view mode (sized dots vs uniform),
// standard-day hour, timeline visibility, legend toggle, selection.
function styleMarkers() {
  var cols = DATA.manifest.colours;
  var view = DATA.manifest.views[S.view];
  var sized = view.map.stations === 'sized';
  var byDate = view.map.timeline === 'dates';
  var hourMode = sized && S.hour !== null && S.hour !== undefined;
  Object.keys(MAP.markers).forEach(function (id) {
    var m = MAP.markers[id], s = m.station;
    var selected = id === S.station;
    var live = (!byDate || s.first_trip <= S.date) && (S.show.stations || selected);
    var radius = DOT_RADIUS, fill = cols.ui.station;
    if (hourMode) {
      var h = hourlyFor(id, S.hour) || { out: 0, in: 0 };
      var t = h.out + h.in;
      radius = hourRadius(t);
      fill = t ? lerpColor(cols.roles.destination, cols.roles.origin, h.out / t) : cols.ui.station_dim;
    } else if (sized) {
      radius = sizedRadius(s.trips);
    }
    m.setStyle({
      fillColor: selected ? cols.ui.station_selected : fill,
      color: selected ? cols.ui.ink : '#fff',
      weight: selected ? 2 : 1.5,
      fillOpacity: selected ? 1 : 0.85,
      radius: selected ? radius + 3 : radius
    });
    if (live) { if (!m._map) m.addTo(MAP.map); m.bringToFront(); } else if (m._map) { m.remove(); }
  });
}

// ── Selected-station route lines ──────────────────────────────────────────────
// Each layer in view.map.lines has a `map_lines` spec; its rows are partner
// stations and the polyline follows routes.json. The same code draws
// outbound/inbound flows (phase 1) and commuter-coloured corridors (phase 3).
function drawLines() {
  MAP.lineLayer.clearLayers();
  var view = DATA.manifest.views[S.view];
  if (!S.station || !view.map.lines.length) return;
  var maxTrips = 1;
  var todo = [];
  view.map.lines.forEach(function (name) {
    var meta = DATA.manifest.layers[name];
    var spec = meta.map_lines; if (!spec) return;
    if (spec.role !== 'both' && !S.show[spec.role]) return;
    var rows = layerData(meta, S) || [];
    rows.forEach(function (r) {
      if (spec.colour_key && S.show.corridor[r[spec.colour_key]] === false) return;
      var a = spec.role === 'destination' ? r.station : S.station;
      var b = spec.role === 'destination' ? S.station : r.station;
      var colour = spec.colour || (spec.colour_map ? spec.colour_map[r[spec.colour_key]] : '#0065bd');
      todo.push({ a: a, b: b, row: r, colour: colour, spec: spec });
      maxTrips = Math.max(maxTrips, r.trips || 0);
    });
  });
  todo.forEach(function (t) {
    var path = routeFor(t.a, t.b);
    if (!path) return;
    var w = 1.5 + 5 * Math.sqrt((t.row.trips || 0) / maxTrips);
    var dash = t.spec.role === 'destination' ? '6 7' : null;
    var line = L.polyline(path, { color: t.colour, weight: w, opacity: 0.8, dashArray: dash, lineCap: 'butt', lineJoin: 'round' });
    var partner = t.row.station;
    var arrow = t.spec.role === 'destination' ? partner + ' → ' + S.station : (t.spec.role === 'origin' ? S.station + ' → ' + partner : S.station + ' ↔ ' + partner);
    var tip = '<b>' + arrow + '</b><br>' + fmtNum(t.row.trips) + ' trips';
    if (t.row.commuter) tip += ' · ' + t.row.commuter;
    if (t.row.exp_any !== undefined) tip += '<br>' + fmtNum(t.row.exp_any, 0, '%') + ' of route on cycle infrastructure';
    line.bindTooltip(tip, { sticky: true });
    line.on('mouseover', function () { line.setStyle({ opacity: 1, weight: w + 2 }); });
    line.on('mouseout', function () { line.setStyle({ opacity: 0.8, weight: w }); });
    line.on('click', function (e) { L.DomEvent.stopPropagation(e); selectStation(partner); });
    line.addTo(MAP.lineLayer);
  });
}

// ── City-wide corridor flow map (no station selected) ─────────────────────────
var LOAD_KEYS = { commuter: 'c', 'non-commuter': 'n', unclassified: 'u' };

function drawLoads() {
  MAP.loadLayer.clearLayers();
  var view = DATA.manifest.views[S.view];
  if (view.map.loads !== 'corridor' || S.station) return;
  var fc = DATA.files['corridor_load.geojson'];
  if (!fc || !fc.features.length) return;
  var cols = DATA.manifest.colours.corridor;
  // Draw least-important category first so commuter sits on top.
  ['unclassified', 'non-commuter', 'commuter'].forEach(function (cat) {
    if (!S.show.corridor[cat]) return;
    var key = LOAD_KEYS[cat], max = fc.max[key] || 1;
    L.geoJSON(fc, {
      filter: function (f) { return f.properties[key] / max >= 0.02; },
      style: function (f) {
        var w = 0.5 + 9 * Math.sqrt(f.properties[key] / max);
        return { color: cols[cat], weight: w, opacity: 0.7, lineCap: 'round' };
      },
      onEachFeature: function (f, layer) {
        layer.bindTooltip('<b>' + cat + ' corridors</b><br>' + fmtNum(f.properties[key]) + ' trips on this street<br>' +
          '<span style="color:#5e5e5e">all categories: ' + fmtNum(f.properties.c + f.properties.n + f.properties.u) + '</span>', { sticky: true });
      }
    }).addTo(MAP.loadLayer);
  });
}

// ── Infrastructure ────────────────────────────────────────────────────────────
function buildInfraLayer() {
  var fc = DATA.files['infra.geojson'];
  var cols = DATA.manifest.colours.infra;
  if (!fc) return;
  var start = DATA.files['infra_timeline.json'].study_start;
  L.geoJSON(fc, {
    style: function (f) { return { color: cols[f.properties.type] || '#999', weight: 2.5, opacity: 0.85 }; },
    onEachFeature: function (f, layer) {
      var p = f.properties;
      layer.bindTooltip('<b>' + (p.name || p.scheme || 'Cycle route') + '</b><br>' + p.type + ' · ' + fmtNum(p.km, 2, ' km') + '<br>' +
        (p.opened <= start ? 'Open before study start' : 'Opened ' + fmtDate(p.opened)), { sticky: true });
      MAP.infraFeatures.push({ layer: layer, opened: p.opened, type: p.type });
    }
  });
}

function buildSegregatedLayer() {
  var fc = DATA.files['segregated.geojson'];
  if (!fc) return;
  MAP.segMax = fc.max || { t: 1, c: 1 };
  L.geoJSON(fc, {
    onEachFeature: function (f, layer) {
      var p = f.properties;
      layer.bindTooltip(function () {
        return '<b>' + p.name + '</b><br>' + fmtNum(p.km, 2, ' km') + (p.opened > DATA.files['infra_timeline.json'].study_start ? ' · opened ' + fmtDate(p.opened) : '') +
          '<br>' + fmtNum(p.t) + ' trips followed this segment<br>' + fmtNum(p.c) + ' on commuter corridors · ' + fmtNum(p.n) + ' non-commuter';
      }, { sticky: true });
      MAP.segFeatures.push({ layer: layer, props: p });
    }
  });
}

function drawInfra() {
  var mode = DATA.manifest.views[S.view].map.infra;
  MAP.infraLayer.clearLayers();
  if (mode === 'none') return;
  if (mode === 'segregated') { drawSegregated(); return; }
  var faint = mode === 'all';
  MAP.infraFeatures.forEach(function (f) {
    if (!S.show.infra[f.type]) return;
    var show = mode === 'all' ? f.opened <= DATA.manifest.summary.date_end : f.opened <= S.date;
    if (!show) return;
    f.layer.setStyle({ opacity: faint ? 0.45 : 0.9, weight: faint ? 2 : 3 });
    f.layer.addTo(MAP.infraLayer);
  });
}

function drawSegregated() {
  var key = S.seg_mode === 'commuter' ? 'c' : 't';
  var max = MAP.segMax[key] || 1;
  var col = DATA.manifest.colours.infra.segregated;
  MAP.segFeatures.forEach(function (f) {
    var v = f.props[key];
    if (v > 0) {
      f.layer.setStyle({ color: col, weight: 2 + 10 * Math.sqrt(v / max), opacity: 0.85, dashArray: null });
    } else {
      f.layer.setStyle({ color: col, weight: 1.5, opacity: 0.5, dashArray: '3 5' });
    }
    f.layer.addTo(MAP.infraLayer);
  });
}

// ── Legend (every entry toggles something) ────────────────────────────────────
function legendItem(html, on, onClick, radio) {
  var b = el('button', 'lg' + (on ? (radio ? ' radio on' : '') : ' off'), html);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function drawLegend() {
  var box = document.getElementById('map-legend');
  clear(box);
  var view = DATA.manifest.views[S.view];
  var cols = DATA.manifest.colours;
  (view.legend || []).forEach(function (group) {
    var g = el('div', 'lg-group');
    if (group === 'lines') {
      g.appendChild(el('span', 'lg-title', 'Routes'));
      g.appendChild(legendItem('<i style="background:' + cols.roles.origin + '"></i>Outbound (trips start here)', S.show.origin,
        function () { S.show.origin = !S.show.origin; drawLines(); drawLegend(); }));
      g.appendChild(legendItem('<i style="background:repeating-linear-gradient(90deg,' + cols.roles.destination + ' 0 5px,transparent 5px 8px)"></i>Inbound (trips end here)', S.show.destination,
        function () { S.show.destination = !S.show.destination; drawLines(); drawLegend(); }));
    } else if (group === 'infra') {
      g.appendChild(el('span', 'lg-title', 'Infrastructure'));
      Object.keys(cols.infra).forEach(function (t) {
        g.appendChild(legendItem('<i style="background:' + cols.infra[t] + '"></i>' + t, S.show.infra[t],
          function () { S.show.infra[t] = !S.show.infra[t]; drawInfra(); drawLegend(); }));
      });
    } else if (group === 'corridor') {
      g.appendChild(el('span', 'lg-title', 'Corridors'));
      Object.keys(cols.corridor).forEach(function (c) {
        g.appendChild(legendItem('<i style="background:' + cols.corridor[c] + '"></i>' + c, S.show.corridor[c],
          function () { S.show.corridor[c] = !S.show.corridor[c]; drawLoads(); drawLines(); drawLegend(); }));
      });
      if (!S.station) g.appendChild(el('span', 'lg-note', 'line width = trips on that street'));
    } else if (group === 'segmode') {
      g.appendChild(el('span', 'lg-title', 'Segregated'));
      [['all', 'All trips'], ['commuter', 'Commuter corridors only']].forEach(function (m) {
        g.appendChild(legendItem('<i style="background:' + cols.infra.segregated + '"></i>' + m[1], S.seg_mode === m[0],
          function () { setSegMode(m[0]); }, true));
      });
      g.appendChild(el('span', 'lg-note', 'line width = trips that followed the segment'));
    } else if (group === 'stations') {
      var sized = view.map.stations === 'sized';
      g.appendChild(legendItem('<i class="dot" style="background:' + cols.ui.station + '"></i>stations' + (sized ? ' (size = trips)' : ''), S.show.stations,
        function () { S.show.stations = !S.show.stations; styleMarkers(); drawLegend(); }));
    }
    box.appendChild(g);
  });
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
  drawInfra();
  drawLoads();
  drawLines();
  styleMarkers();
  drawLegend();
}
