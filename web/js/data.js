// data.js — fetches web/data/*.json once and exposes them on a single object.
// The manifest lists every layer and the file it reads; files are fetched
// lazily by name so adding a layer never touches this file.

'use strict';

var DATA = {
  manifest: null,
  files: {},          // file name -> parsed JSON
  hourlyMax: 1,       // largest per-day (out+in) rate for any station, hour and day type
  loadedAt: null
};

// Map layers that are not manifest layers but the map always needs.
var MAP_FILES = ['stations.json', 'routes.json', 'infra.geojson', 'corridor_load.geojson', 'segregated.geojson',
                 'premises.json', 'census_by_station.json', 'census_summary.json', 'system_profile.json'];
// Files the map uses when they exist. The output-area choropleth needs census
// boundaries the build can only reach on the author's machine, so a build
// without it must still produce a working site (the map falls back to buffers).
var OPTIONAL_FILES = ['oa.geojson'];

function fetchJSON(path) {
  return fetch(path, { cache: 'no-cache' }).then(function (r) {
    if (!r.ok) throw new Error('Failed to load ' + path + ' (' + r.status + ')');
    return r.json();
  });
}

// Load the manifest plus every distinct file referenced by its layers and the map.
function loadAll() {
  return fetchJSON('data/manifest.json').then(function (m) {
    DATA.manifest = m;
    var names = {};
    MAP_FILES.forEach(function (f) { names[f] = 1; });
    Object.values(m.layers).forEach(function (l) { if (l.file) names[l.file] = 1; });
    Object.values(m.controls || {}).forEach(function (c) { if (c.options_from) names[c.options_from.file] = 1; });
    OPTIONAL_FILES.forEach(function (f) { delete names[f]; });
    return Promise.all(Object.keys(names).map(function (f) {
      return fetchJSON('data/' + f).then(function (json) { DATA.files[f] = json; });
    }).concat(OPTIONAL_FILES.map(function (f) {
      return fetchJSON('data/' + f).then(function (json) { DATA.files[f] = json; }, function () {});
    })));
  }).then(function () {
    // Standard-day marker scale: trips per day so weekdays and weekends compare.
    var od = DATA.files['od_by_station.json'] || {};
    Object.keys(od).forEach(function (id) {
      ['all', 'weekday', 'weekend'].forEach(function (dt) {
        var days = dayCount(dt);
        ((od[id][dt] || {}).hourly || []).forEach(function (h) {
          DATA.hourlyMax = Math.max(DATA.hourlyMax, (h.out + h.in) / days);
        });
      });
    });
    DATA.loadedAt = new Date();
    return DATA;
  });
}

// Number of calendar days of a day type in the study (from system_profile.json).
function dayCount(daytype) {
  var k = (DATA.files['system_profile.json'] || {}).kpi || {};
  var wd = k.days_weekday || 1, we = k.days_weekend || 1;
  return daytype === 'weekday' ? wd : daytype === 'weekend' ? we : wd + we;
}

// Resolve the data a layer should render for the current state.
//   scope: station     -> files[file][S.station]
//   scope: global      -> files[file]
//   path               -> ordered hops; "$key" reads state[key]
//   field_from_state   -> hop(s) through state values (string or list), then
//   field              -> final hop(s), dotted ("compare.dest")
function layerData(layer, state) {
  if (!layer.file) return null;
  var root = DATA.files[layer.file];
  if (!root) return null;
  var node = root;
  if (layer.scope === 'station') {
    if (!state.station) return null;
    node = root[state.station];
    if (!node) return null;
  }
  var hops = [];
  if (layer.path) hops = layer.path.slice();
  else {
    [].concat(layer.field_from_state || []).forEach(function (k) { hops.push('$' + k); });
    if (layer.field) hops = hops.concat(String(layer.field).split('.'));
  }
  for (var i = 0; i < hops.length; i++) {
    var h = hops[i];
    var key = h.charAt(0) === '$' ? state[h.slice(1)] : h;
    if (node === null || node === undefined) return null;
    node = node[key];
  }
  return node === undefined ? null : node;
}

// Visibility rule: every key in `cond` must match state. `station: false`
// means "no station selected", `station: true` "a station is selected".
function showIf(cond, state) {
  if (!cond) return true;
  return Object.keys(cond).every(function (k) {
    if (k === 'station') return !!state.station === !!cond[k];
    return String(state[k]) === String(cond[k]);
  });
}

// ── Controls (manifest.controls) ─────────────────────────────────────────────
function controlOptions(ctrl) {
  if (ctrl.options) return ctrl.options.map(function (o) { return { value: String(o.value), label: o.label, colour: o.colour, fit: o.fit }; });
  if (ctrl.options_from) {
    var src = (DATA.files[ctrl.options_from.file] || {})[ctrl.options_from.field] || {};
    return Object.keys(src).map(function (k) { return { value: k, label: src[k].label || k, title: src[k].desc }; });
  }
  return [];
}
function controlFor(stateKey) {
  var cs = DATA.manifest.controls || {};
  var name = Object.keys(cs).find(function (n) { return cs[n].state === stateKey; });
  return name ? cs[name] : null;
}
// Label of the active option of the control bound to a state key ('' if none).
function controlLabel(stateKey, state) {
  var ctrl = controlFor(stateKey);
  if (!ctrl) return '';
  var cur = String(state[stateKey]);
  var o = controlOptions(ctrl).find(function (x) { return x.value === cur; });
  return o ? o.label : cur;
}
// "{daytype}" style placeholders in titles -> the active control label.
function fmtTitle(str, state) {
  if (!str || !state) return str || '';
  return String(str).replace(/\{(\w+)\}/g, function (m, k) {
    var lab = controlLabel(k, state);
    return lab || m;
  });
}

// ── Census helpers (neighbourhood maps) ──────────────────────────────────────
function censusVarMeta() {
  var v = ((DATA.files['census_summary.json'] || {}).vars || {})[S.census_var];
  return v || { label: S.census_var, unit: '', dp: 1 };
}
function censusRow(id) {
  var e = (DATA.files['census_by_station.json'] || {})[id];
  return e ? e[S.buffer] || null : null;
}
function censusValue(id) {
  var r = censusRow(id);
  var v = r ? r[S.census_var] : null;
  return v === undefined ? null : v;
}
// Colour range for the choropleth: 5th to 95th percentile of the variable
// across the output areas, so a station's buffer is coloured on the same scale
// as the areas it covers and reads as their average. Falls back to the spread
// across station buffers when the output-area layer was not built.
function censusScale() {
  var sum = DATA.files['census_summary.json'] || {};
  var st = (sum.oa_scale || {})[S.census_var];
  if (!st) st = ((sum.rank || {})[S.census_var] || {})[S.buffer];
  if (!st || st.n === 0) return null;
  return { lo: st.q05, hi: st.q95, stats: st };
}
// A value's 0-1 position on the colour ramp (null when there is no value).
function censusRamp(v) {
  var sc = censusScale();
  if (!sc || v === null || v === undefined) return null;
  return sc.hi > sc.lo ? (v - sc.lo) / (sc.hi - sc.lo) : 0.5;
}

function stations() { return DATA.files['stations.json'] || []; }
function stationById(id) { return stations().find(function (s) { return s.id === id; }) || null; }
function routeFor(a, b) {
  var r = DATA.files['routes.json'];
  return r && r.pairs ? (r.pairs[a + '|' + b] || r.pairs[b + '|' + a] || null) : null;
}
function hourlyFor(id, hour, daytype) {
  var e = (DATA.files['od_by_station.json'] || {})[id];
  var block = e ? e[daytype || S.daytype] : null;
  if (!block || !block.hourly) return null;
  return block.hourly.find(function (h) { return h.hour === hour; }) || null;
}
// Trips per day (starting + ending) at a station in an hour of the active day type.
function hourRate(id, hour) {
  var h = hourlyFor(id, hour);
  return h ? (h.out + h.in) / dayCount(S.daytype) : 0;
}
