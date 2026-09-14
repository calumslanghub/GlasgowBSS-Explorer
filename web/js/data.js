// data.js — fetches web/data/*.json once and exposes them on a single object.
// The manifest lists every layer and the file it reads; files are fetched
// lazily by name so adding a layer never touches this file.

'use strict';

var DATA = {
  manifest: null,
  files: {},          // file name -> parsed JSON
  loadedAt: null
};

function fetchJSON(path) {
  return fetch(path, { cache: 'no-cache' }).then(function (r) {
    if (!r.ok) throw new Error('Failed to load ' + path + ' (' + r.status + ')');
    return r.json();
  });
}

// Load the manifest plus every distinct file referenced by its layers,
// stations.json, routes.json and infra.geojson (the map layers).
function loadAll() {
  return fetchJSON('data/manifest.json').then(function (m) {
    DATA.manifest = m;
    var names = { 'stations.json': 1, 'routes.json': 1, 'infra.geojson': 1 };
    Object.values(m.layers).forEach(function (l) { names[l.file] = 1; });
    return Promise.all(Object.keys(names).map(function (f) {
      return fetchJSON('data/' + f).then(function (json) { DATA.files[f] = json; });
    }));
  }).then(function () {
    DATA.loadedAt = new Date();
    return DATA;
  });
}

// Resolve the data a layer should render for the current state.
//   scope: station -> files[file][S.station][field?]
//   scope: global  -> files[file][field?]
function layerData(layer, state) {
  var root = DATA.files[layer.file];
  if (!root) return null;
  var node = root;
  if (layer.scope === 'station') {
    if (!state.station) return null;
    node = root[state.station];
    if (!node) return null;
  }
  if (layer.field) node = node[layer.field];
  return node === undefined ? null : node;
}

function stations() { return DATA.files['stations.json'] || []; }
function routeFor(a, b) {
  var r = DATA.files['routes.json'];
  return r && r.pairs ? (r.pairs[a + '|' + b] || r.pairs[b + '|' + a] || null) : null;
}
