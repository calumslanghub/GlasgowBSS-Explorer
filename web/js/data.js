// data.js — fetches web/data/*.json once and exposes them on a single object.
// The manifest lists every layer and the file it reads; files are fetched
// lazily by name so adding a layer never touches this file.

'use strict';

var DATA = {
  manifest: null,
  files: {},          // file name -> parsed JSON
  hourlyMax: 1,       // largest out+in for any station in any hour (standard-day scale)
  loadedAt: null
};

// Map layers that are not manifest layers but the map always needs.
var MAP_FILES = ['stations.json', 'routes.json', 'infra.geojson', 'corridor_load.geojson', 'segregated.geojson'];

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
    Object.values(m.layers).forEach(function (l) { names[l.file] = 1; });
    return Promise.all(Object.keys(names).map(function (f) {
      return fetchJSON('data/' + f).then(function (json) { DATA.files[f] = json; });
    }));
  }).then(function () {
    var od = DATA.files['od_by_station.json'] || {};
    Object.values(od).forEach(function (e) {
      (e.hourly || []).forEach(function (h) { DATA.hourlyMax = Math.max(DATA.hourlyMax, h.out + h.in); });
    });
    DATA.loadedAt = new Date();
    return DATA;
  });
}

// Resolve the data a layer should render for the current state.
//   scope: station     -> files[file][S.station][field?]
//   scope: global      -> files[file][field?]
//   field_from_state   -> an extra hop through files[file][S[<key>]] first
function layerData(layer, state) {
  var root = DATA.files[layer.file];
  if (!root) return null;
  var node = root;
  if (layer.scope === 'station') {
    if (!state.station) return null;
    node = root[state.station];
    if (!node) return null;
  }
  if (layer.field_from_state) {
    node = node[state[layer.field_from_state]];
    if (!node) return null;
  }
  if (layer.field) node = node[layer.field];
  return node === undefined ? null : node;
}

function stations() { return DATA.files['stations.json'] || []; }
function stationById(id) { return stations().find(function (s) { return s.id === id; }) || null; }
function routeFor(a, b) {
  var r = DATA.files['routes.json'];
  return r && r.pairs ? (r.pairs[a + '|' + b] || r.pairs[b + '|' + a] || null) : null;
}
function hourlyFor(id, hour) {
  var e = (DATA.files['od_by_station.json'] || {})[id];
  if (!e || !e.hourly) return null;
  return e.hourly.find(function (h) { return h.hour === hour; }) || null;
}
