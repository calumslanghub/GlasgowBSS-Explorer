// map.js — Leaflet map: station markers (sized dots, census buffers or 2.5D
// population columns), OD route lines, corridor flow map, infrastructure
// layers, the licensed-premises heat layer and the legend (toggles + controls).
// Reads global state S (app.js) and DATA (data.js); exposes a small MAP api.
// Everything the map draws is decided by the active view's `map`, `legend`
// and `controls` config in the manifest, so a new overlay is a config entry.

'use strict';

var MAP = {
  map: null,
  markers: {},        // station id -> L.circleMarker
  lineLayer: null,    // selected station's route polylines
  loadLayer: null,    // city-wide corridor flow map
  infraLayer: null,   // cycle infrastructure (all / timeline / segregated)
  bufferLayer: null,  // census buffer circles
  barLayer: null,     // residents vs workplace columns
  heatLayer: null,    // licensed premises heat map
  infraFeatures: [],  // cached leaflet layers from infra.geojson
  segFeatures: []     // cached leaflet layers from segregated.geojson
};

var DOT_RADIUS = 5;
var SMALL_RADIUS = 3.5;
var BAR_MAX_PX = 64;

function initMap() {
  MAP.map = L.map('map', { zoomControl: false, preferCanvas: true }).setView([55.86, -4.26], 12);
  L.control.zoom({ position: 'topright' }).addTo(MAP.map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · Infra: Glasgow City Council · Trips: nextbike Glasgow · Census 2022: NRS · Premises: Glasgow Licensing Board',
    maxZoom: 19, opacity: 0.6
  }).addTo(MAP.map);
  // Heat canvas sits in its own pane under every vector layer.
  MAP.map.createPane('heat');
  MAP.map.getPane('heat').style.zIndex = 350;
  MAP.infraLayer = L.layerGroup().addTo(MAP.map);
  MAP.loadLayer = L.layerGroup().addTo(MAP.map);
  MAP.bufferLayer = L.layerGroup().addTo(MAP.map);
  MAP.lineLayer = L.layerGroup().addTo(MAP.map);
  MAP.barLayer = L.layerGroup().addTo(MAP.map);
  buildStationMarkers();
  buildInfraLayer();
  buildSegregatedLayer();
  // Clicking empty map deselects; feature clicks stop propagation.
  MAP.map.on('click', function () { if (S.station && canSelect()) selectStation(null); });
}

function currentView() { return DATA.manifest.views[S.view]; }
function canSelect() { return currentView().map.select !== false; }
// Station marker mode for the active view; "$key" resolves to a state value.
function stationMode() {
  var m = currentView().map.stations || 'dots';
  return m.charAt(0) === '$' ? (S[m.slice(1)] || 'dots') : m;
}
function clickSelect(id) {
  return function (e) { L.DomEvent.stopPropagation(e); if (canSelect()) selectStation(id); };
}

// ── Stations ──────────────────────────────────────────────────────────────────
function sizedRadius(trips) { return 4 + Math.sqrt(Math.max(trips, 0)) / 30; }
function hourRadius(rate) { return 3 + 16 * Math.sqrt(Math.max(rate, 0) / DATA.hourlyMax); }

function buildStationMarkers() {
  var cols = DATA.manifest.colours.ui;
  stations().forEach(function (s) {
    var m = L.circleMarker([s.lat, s.lon], {
      radius: DOT_RADIUS, color: '#fff', weight: 1.5, fillColor: cols.station, fillOpacity: 0.85
    });
    m.bindTooltip(function () { return stationTip(s); }, { direction: 'top', offset: [0, -4] });
    m.on('click', clickSelect(s.id));
    m.station = s;
    m.addTo(MAP.map);
    MAP.markers[s.id] = m;
  });
  var b = L.latLngBounds(stations().map(function (s) { return [s.lat, s.lon]; }));
  if (b.isValid()) MAP.map.fitBounds(b.pad(0.05));
}

function stationTip(s) {
  var html = '<div class="station-tip"><b>' + s.id + '</b>';
  var mode = stationMode();
  if (mode === 'sized' && S.hour !== null && S.hour !== undefined) {
    var h = hourlyFor(s.id, S.hour) || { out: 0, in: 0 };
    html += fmtNum(h.out) + ' starting · ' + fmtNum(h.in) + ' ending at ' + S.hour + ':00 (' + controlLabel('daytype', S).toLowerCase() + ')';
  } else if (mode === 'buffers') {
    var v = censusValue(s.id), meta = censusVarMeta();
    html += meta.label + ': ' + (v === null ? 'n/a' : fmtNum(v, meta.dp, meta.unit)) + ' · ' + S.buffer + ' m buffer';
  } else if (mode === 'bars') {
    var c = censusRow(s.id) || {};
    html += fmtNum(c.over16pop) + ' residents 16+ · ' + fmtNum(c.workplace_pop) + ' workplace · ' + S.buffer + ' m';
  } else {
    html += fmtNum(s.trips) + ' trips · live from ' + fmtDate(s.first_trip);
  }
  return html + '</div>';
}

// Restyle markers for the current state: view mode (sized dots vs uniform vs
// small dots over buffers/columns), standard-day hour, timeline visibility,
// legend toggle, selection.
function styleMarkers() {
  var cols = DATA.manifest.colours;
  var view = currentView();
  var mode = stationMode();
  var sized = mode === 'sized';
  var small = mode === 'buffers' || mode === 'bars';
  var byDate = view.map.timeline === 'dates';
  var hourMode = sized && S.hour !== null && S.hour !== undefined;
  Object.keys(MAP.markers).forEach(function (id) {
    var m = MAP.markers[id], s = m.station;
    var selected = id === S.station;
    var live = (!byDate || s.first_trip <= S.date) && (S.show.stations || selected);
    var radius = small ? SMALL_RADIUS : DOT_RADIUS, fill = cols.ui.station;
    if (hourMode) {
      var h = hourlyFor(id, S.hour) || { out: 0, in: 0 };
      var t = h.out + h.in;
      radius = hourRadius(hourRate(id, S.hour));
      fill = t ? lerpColor(cols.roles.destination, cols.roles.origin, h.out / t) : cols.ui.station_dim;
    } else if (sized) {
      radius = sizedRadius(s.trips);
    }
    m.setStyle({
      fillColor: selected ? cols.ui.station_selected : fill,
      color: selected ? cols.ui.ink : '#fff',
      weight: selected ? 2 : (small ? 1 : 1.5),
      fillOpacity: selected ? 1 : 0.85,
      radius: selected ? radius + 3 : radius
    });
    if (live) { if (!m._map) m.addTo(MAP.map); m.bringToFront(); } else if (m._map) { m.remove(); }
  });
  document.getElementById('map').classList.toggle('no-select', !canSelect());
}

// ── Census buffers and population columns ─────────────────────────────────────
function rampColor(t) {
  var sc = DATA.manifest.colours.scale;
  t = Math.max(0, Math.min(1, t));
  return t < 0.5 ? lerpColor(sc.low, sc.mid, t * 2) : lerpColor(sc.mid, sc.high, (t - 0.5) * 2);
}

function drawOverlays() {
  MAP.bufferLayer.clearLayers();
  MAP.barLayer.clearLayers();
  var mode = stationMode();
  if (mode === 'buffers') drawBuffers();
  else if (mode === 'bars') drawBars();
}

function drawBuffers() {
  var sc = censusScale();
  if (!sc) return;
  var meta = censusVarMeta();
  var ink = DATA.manifest.colours.ui.ink;
  stations().forEach(function (s) {
    if (!S.show.stations && s.id !== S.station) return;
    var v = censusValue(s.id);
    var t = v === null ? null : (sc.hi > sc.lo ? (v - sc.lo) / (sc.hi - sc.lo) : 0.5);
    var selected = s.id === S.station;
    var circ = L.circle([s.lat, s.lon], {
      radius: +S.buffer, color: selected ? ink : '#fff', weight: selected ? 2.5 : 0.8,
      fillColor: t === null ? '#d9d9d9' : rampColor(t), fillOpacity: selected ? 0.8 : 0.55
    });
    circ.bindTooltip('<b>' + s.id + '</b><br>' + meta.label + ': ' + (v === null ? 'n/a' : fmtNum(v, meta.dp, meta.unit)) + '<br><span style="color:#5e5e5e">' + S.buffer + ' m buffer</span>', { sticky: true });
    circ.on('click', clickSelect(s.id));
    circ.addTo(MAP.bufferLayer);
  });
}

function drawBars() {
  var rows = ((DATA.files['census_summary.json'] || {}).balance || {})[S.buffer] || [];
  if (!rows.length) return;
  var max = rows.reduce(function (m, r) { return Math.max(m, r.residents, r.workplace); }, 1);
  rows.forEach(function (r) {
    var s = stationById(r.station);
    if (!s || (!S.show.stations && s.id !== S.station)) return;
    var hR = Math.max(2, Math.round(BAR_MAX_PX * Math.sqrt(r.residents / max)));
    var hW = Math.max(2, Math.round(BAR_MAX_PX * Math.sqrt(r.workplace / max)));
    var html = '<div class="bar-pair' + (s.id === S.station ? ' sel' : '') + '">' +
      '<i class="res" style="height:' + hR + 'px"></i><i class="work" style="height:' + hW + 'px"></i></div>';
    var icon = L.divIcon({ className: 'bar-icon', html: html, iconSize: [16, BAR_MAX_PX + 4], iconAnchor: [8, BAR_MAX_PX + 2] });
    var mk = L.marker([s.lat, s.lon], { icon: icon, keyboard: false });
    mk.bindTooltip('<b>' + s.id + '</b><br>' + fmtNum(r.residents) + ' residents 16+ · ' + fmtNum(r.workplace) + ' workplace population<br>' +
      '<span style="color:#5e5e5e">' + fmtNum(r.workplace_pct, 0, '%') + ' workplace · ' + S.buffer + ' m buffer</span>', { direction: 'top', offset: [0, -BAR_MAX_PX] });
    mk.on('click', clickSelect(s.id));
    mk.addTo(MAP.barLayer);
  });
}

// ── Licensed premises heat layer ──────────────────────────────────────────────
// Leaflet.heat always puts its canvas in overlayPane (above the vector
// canvas), so the canvas is moved into the low 'heat' pane after adding and
// moved back before removal (the plugin removes it from overlayPane).
function drawHeat() {
  if (MAP.heatLayer) {
    var cv = MAP.heatLayer._canvas;
    if (cv && cv.parentNode !== MAP.map.getPane('overlayPane')) MAP.map.getPane('overlayPane').appendChild(cv);
    MAP.map.removeLayer(MAP.heatLayer);
    MAP.heatLayer = null;
  }
  if (currentView().map.heat !== 'premises' || !S.show.heat || !L.heatLayer) return;
  var p = DATA.files['premises.json'];
  if (!p || !p.points.length) return;
  var pts = p.points.map(function (q) { return [q[0], q[1], 0.6 + (q[2] ? Math.min(q[2], 600) / 600 * 0.4 : 0)]; });
  MAP.heatLayer = L.heatLayer(pts, {
    radius: 22, blur: 18, maxZoom: 15, max: 5, minOpacity: 0.2,
    gradient: { 0.15: '#ffffb2', 0.4: '#fecc5c', 0.6: '#fd8d3c', 0.8: '#f03b20', 1: '#bd0026' }
  }).addTo(MAP.map);
  if (MAP.heatLayer._canvas) MAP.map.getPane('heat').appendChild(MAP.heatLayer._canvas);
}

// ── Selected-station route lines ──────────────────────────────────────────────
// Each layer in view.map.lines has a `map_lines` spec; its rows are partner
// stations and the polyline follows routes.json. The same code draws
// outbound/inbound flows (station flows) and commuter-coloured corridors.
function drawLines() {
  MAP.lineLayer.clearLayers();
  var view = currentView();
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
    if (t.row.share !== undefined) tip += ' (' + fmtNum(t.row.share, 1, '%') + ', ' + controlLabel('daytype', S).toLowerCase() + ')';
    if (t.row.commuter) tip += ' · ' + t.row.commuter;
    if (t.row.exp_any !== undefined) tip += '<br>' + fmtNum(t.row.exp_any, 0, '%') + ' of route on cycle infrastructure';
    line.bindTooltip(tip, { sticky: true });
    line.on('mouseover', function () { line.setStyle({ opacity: 1, weight: w + 2 }); });
    line.on('mouseout', function () { line.setStyle({ opacity: 0.8, weight: w }); });
    line.on('click', clickSelect(partner));
    line.addTo(MAP.lineLayer);
  });
}

// ── City-wide corridor flow map (no station selected) ─────────────────────────
var LOAD_KEYS = { commuter: 'c', 'non-commuter': 'n' };

function drawLoads() {
  MAP.loadLayer.clearLayers();
  var view = currentView();
  if (view.map.loads !== 'corridor' || S.station) return;
  var fc = DATA.files['corridor_load.geojson'];
  if (!fc || !fc.features.length) return;
  var cols = DATA.manifest.colours.corridor;
  // Draw non-commuter first so commuter sits on top.
  ['non-commuter', 'commuter'].forEach(function (cat) {
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
          '<span style="color:#5e5e5e">both categories: ' + fmtNum(f.properties.c + f.properties.n) + '</span>', { sticky: true });
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
  var mode = currentView().map.infra;
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
  var col = S.seg_mode === 'commuter' ? DATA.manifest.colours.corridor.commuter : DATA.manifest.colours.infra.segregated;
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

// ── Legend (every entry toggles something) and controls ───────────────────────
function legendItem(html, on, onClick, radio) {
  // Toggles strike through when off; radio options just lose the highlight.
  var b = el('button', 'lg' + (radio ? ' radio' + (on ? ' on' : '') : (on ? '' : ' off')), html);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

// One manifest control -> a legend group (radio buttons or a select).
function controlGroup(name) {
  var ctrl = DATA.manifest.controls[name];
  if (!ctrl || !showIf(ctrl.show_if, S)) return null;
  var g = el('div', 'lg-group lg-ctrl');
  g.appendChild(el('span', 'lg-title', ctrl.label));
  var opts = controlOptions(ctrl);
  var cur = String(S[ctrl.state]);
  if (ctrl.widget === 'select') {
    var sel = el('select', 'lg-select');
    sel.setAttribute('aria-label', ctrl.label);
    opts.forEach(function (o) {
      var op = el('option', '', o.label); op.value = o.value;
      if (o.title) op.title = o.title;
      if (o.value === cur) op.selected = true;
      sel.appendChild(op);
    });
    sel.addEventListener('change', function () { setControl(ctrl.state, sel.value); });
    g.appendChild(sel);
  } else {
    opts.forEach(function (o) {
      var sw = o.colour ? '<i class="dot" style="background:' + o.colour + '"></i>' : '';
      g.appendChild(legendItem(sw + o.label, o.value === cur, function () { setControl(ctrl.state, o.value); }, true));
    });
  }
  if (ctrl.note) g.appendChild(el('span', 'lg-note', ctrl.note));
  return g;
}

function drawLegend() {
  var box = document.getElementById('map-legend');
  clear(box);
  var view = currentView();
  var cols = DATA.manifest.colours;
  (view.controls || []).forEach(function (name) {
    var g = controlGroup(name);
    if (g) box.appendChild(g);
  });
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
    } else if (group === 'scale') {
      if (stationMode() === 'buffers') {
        var sc = censusScale(), meta = censusVarMeta();
        if (!sc) return;
        g.appendChild(el('span', 'lg-title', meta.label));
        var ramp = el('span', 'lg-ramp');
        ramp.style.background = 'linear-gradient(90deg,' + cols.scale.low + ',' + cols.scale.mid + ',' + cols.scale.high + ')';
        g.appendChild(el('span', 'lg-note', fmtNum(sc.lo, meta.dp, meta.unit)));
        g.appendChild(ramp);
        g.appendChild(el('span', 'lg-note', fmtNum(sc.hi, meta.dp, meta.unit)));
        if (meta.desc) g.appendChild(el('span', 'lg-note lg-wide', meta.desc + '. Colour range = 5th to 95th percentile.'));
      } else if (stationMode() === 'bars') {
        g.appendChild(el('span', 'lg-title', 'Columns'));
        g.appendChild(el('span', 'lg', '<i class="col" style="background:' + cols.balance.residents + '"></i>residents 16+'));
        g.appendChild(el('span', 'lg', '<i class="col" style="background:' + cols.balance.workplace + '"></i>workplace population'));
        g.appendChild(el('span', 'lg-note', 'height = people in the buffer (square-root scale)'));
      }
    } else if (group === 'heat') {
      if (view.map.heat === 'premises') {
        g.appendChild(el('span', 'lg-title', 'Premises'));
        g.appendChild(legendItem('<i class="heat"></i>licensed premises heat map' + (L.heatLayer ? '' : ' (unavailable)'), S.show.heat,
          function () { S.show.heat = !S.show.heat; drawHeat(); drawLegend(); }));
      }
    } else if (group === 'stations') {
      var mode = stationMode();
      g.appendChild(legendItem('<i class="dot" style="background:' + cols.ui.station + '"></i>stations' + (mode === 'sized' ? ' (size = trips)' : ''), S.show.stations,
        function () { S.show.stations = !S.show.stations; styleMarkers(); drawOverlays(); drawLegend(); }));
    }
    if (g.childNodes.length) box.appendChild(g);
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
  drawHeat();
  drawInfra();
  drawLoads();
  drawOverlays();
  drawLines();
  styleMarkers();
  drawLegend();
}
