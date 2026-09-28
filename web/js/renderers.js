// renderers.js — the GENERIC renderers, chosen per layer by its `render` field.
//
//   bar   - Chart.js bar chart. Horizontal ranked lists (top destinations,
//           corridors, exposure by type), vertical stacked/100% or grouped
//           series (hourly split, weekday vs weekend day), floating-bar
//           intervals (coefficient plot) and dumbbells (weekday vs weekend
//           share) are the SAME renderer, configured by meta: orientation,
//           series | value_key | intervals | dumbbell, label_key | x_key,
//           stacked, percent, colour | colour_key + colour_map, rows, head,
//           tail, max, unit, ref_line, tip_keys, marker.
//   line  - Chart.js multi-series line (km open by date; IRR by exposure) with
//           optional stacked fill, a secondary-axis series, a horizontal
//           reference line and a vertical marker at a state value.
//   kpi   - stat tiles from an object (or from the timeline row at the marker).
//   text  - a narrative card with {placeholders} filled from data / summary.
//
// Each renderer: render(container, data, meta, state) -> appends a card and
// returns a handle {chart, update(state)} so app.js can refresh in place.
// Renderers read state; they never own navigation.

'use strict';

var RENDERERS = {};

// ── helpers ───────────────────────────────────────────────────────────────────
// Chart.js measures its parent, so every canvas lives in its own fixed-height box.
function chartBox(parent, height) {
  var box = el('div', 'chart-box');
  box.style.height = height + 'px';
  var canvas = document.createElement('canvas');
  box.appendChild(canvas);
  parent.appendChild(box);
  return canvas;
}

function rowsFromData(data, meta) {
  // `rows` in meta turns an object {key: value} into ranked rows.
  var rows;
  if (meta.rows) {
    rows = meta.rows.map(function (r) {
      return { label: r.label, value: data ? data[r.key] : null, colour: r.colour, key: r.key };
    });
  } else {
    // A data object carrying `rows` (plus scalars such as a ref_key) is fine too.
    var list = Array.isArray(data) ? data : (data && Array.isArray(data.rows) ? data.rows : []);
    rows = list.slice();
  }
  if (meta.head) rows = rows.slice(0, meta.head);
  if (meta.tail) rows = rows.slice(-meta.tail).reverse();
  return rows;
}

function rowColour(r, meta) {
  if (r.colour) return r.colour;
  if (meta.colour_key && meta.colour_map) return meta.colour_map[r[meta.colour_key]] || '#b3b3b3';
  return meta.colour || '#0065bd';
}

function swatchLegend(items) {
  // items: [{label, colour, dot}] -> inline legend under a chart
  var lg = el('div', 'legend-inline');
  items.forEach(function (it) {
    lg.appendChild(el('span', '', '<i class="' + (it.dot ? 'dot' : '') + '" style="background:' + it.colour + '"></i>' + it.label));
  });
  return lg;
}

function categoryLegend(meta) {
  if (!(meta.colour_key && meta.colour_map)) return null;
  return swatchLegend(Object.keys(meta.colour_map).map(function (k) { return { label: k, colour: meta.colour_map[k] }; }));
}

function num(v) { var n = Number(v); return Number.isFinite(n) ? n : 0; }

// Vertical guide plugin: dashed line at chart.$markerIndex (category index).
var markerPlugin = {
  id: 'stateMarker',
  afterDatasetsDraw: function (chart) {
    var idx = chart.$markerIndex;
    if (idx === undefined || idx === null || idx < 0) return;
    var x = chart.scales.x.getPixelForValue(idx);
    var ctx = chart.ctx, area = chart.chartArea;
    ctx.save(); ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(x, area.top); ctx.lineTo(x, area.bottom); ctx.stroke(); ctx.restore();
  }
};

// Reference line plugin: dashed line at a data value on the value axis
// (chart.$refValue on scale chart.$refAxis, 'x' or 'y'), drawn over the bars
// so a benchmark every bar exceeds stays visible.
var refLinePlugin = {
  id: 'refLine',
  afterDatasetsDraw: function (chart) {
    var v = chart.$refValue;
    if (v === undefined || v === null) return;
    var scale = chart.scales[chart.$refAxis || 'x'];
    if (!scale) return;
    var ctx = chart.ctx, area = chart.chartArea;
    ctx.save(); ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
    ctx.beginPath();
    if (chart.$refAxis === 'y') {
      var y = scale.getPixelForValue(v); ctx.moveTo(area.left, y); ctx.lineTo(area.right, y);
    } else {
      var x = scale.getPixelForValue(v); ctx.moveTo(x, area.top); ctx.lineTo(x, area.bottom);
    }
    ctx.stroke(); ctx.restore();
  }
};

// Points plugin: draws dots on floating bars. A dataset lists them in
// `$points: [{key, colour, radius}]`; the row values come from chart.$rows.
var pointsPlugin = {
  id: 'barPoints',
  afterDatasetsDraw: function (chart) {
    var rows = chart.$rows || [];
    var horizontal = chart.options.indexAxis === 'y';
    chart.data.datasets.forEach(function (ds, di) {
      if (!ds.$points || !ds.$points.length) return;
      var meta = chart.getDatasetMeta(di);
      if (meta.hidden) return;
      var ctx = chart.ctx;
      meta.data.forEach(function (elem, i) {
        var r = rows[i]; if (!r) return;
        ds.$points.forEach(function (pt) {
          var v = r[pt.key]; if (v === null || v === undefined) return;
          var px = horizontal ? chart.scales.x.getPixelForValue(num(v)) : elem.x;
          var py = horizontal ? elem.y : chart.scales.y.getPixelForValue(num(v));
          ctx.save(); ctx.beginPath(); ctx.arc(px, py, pt.radius || 4.5, 0, Math.PI * 2);
          ctx.fillStyle = pt.colour; ctx.fill();
          ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.restore();
        });
      });
    });
  }
};

// Extra tooltip lines from meta.tip_keys (and the older share_key / km fields).
function tipExtras(r, meta) {
  var out = [];
  (meta.tip_keys || []).forEach(function (t) {
    var v = r[t.key];
    if (v === null || v === undefined) return;
    out.push(' ' + t.label + ': ' + (typeof v === 'number' ? fmtNum(v, t.dp || 0, t.unit || '') : String(v)));
  });
  if (meta.share_key && r[meta.share_key] !== undefined) out.push(' ' + fmtNum(r[meta.share_key], 1, '%') + ' of trips');
  if (meta.colour_key && r[meta.colour_key] && !meta.intervals) out.push(' ' + r[meta.colour_key]);
  if (r.km !== undefined && !meta.tip_keys) out.push(' ' + fmtNum(r.km, 1, ' km'));
  return out;
}

// ── GENERIC 1: bar ────────────────────────────────────────────────────────────
RENDERERS.bar = function (container, data, meta, state) {
  var c = makeCard(meta, state, data);
  container.appendChild(c.card);
  var horizontal = (meta.orientation || 'horizontal') === 'horizontal';
  var rows = rowsFromData(data, meta);
  if (!rows.length) { c.body.appendChild(el('div', 'card-empty', 'No data.')); return null; }

  var rowH = meta.intervals ? 24 : 22;
  var height = horizontal ? Math.max(120, rowH * rows.length + 30 + (meta.intervals ? 24 : 0)) : 190;
  var canvas = chartBox(c.body, height);
  var labelKey = meta.label_key || (meta.rows ? 'label' : meta.x_key);
  var labels = rows.map(function (r) {
    var v = r[labelKey];
    return horizontal ? shortName(v) : (v + (meta.x_suffix || ''));
  });
  var unit = meta.unit || (meta.percent ? '%' : '');
  var datasets = [];
  var legendItems = null;    // inline legend for dumbbell points
  var beginAtZero = true;

  if (meta.series) {
    var totals = rows.map(function (r) {
      return meta.series.reduce(function (s, sr) { return s + num(r[sr.key]); }, 0);
    });
    datasets = meta.series.map(function (sr) {
      return {
        label: sr.label, backgroundColor: hexAlpha(sr.colour, 0.85), borderColor: sr.colour, borderWidth: 1,
        raw: rows.map(function (r) { return num(r[sr.key]); }),
        data: rows.map(function (r, i) {
          var v = num(r[sr.key]);
          return meta.percent ? (totals[i] ? +(v / totals[i] * 100).toFixed(1) : 0) : v;
        }),
        stack: meta.stacked ? 's' : undefined
      };
    });
  } else if (meta.dumbbell) {
    var a = meta.dumbbell.a, b = meta.dumbbell.b;
    datasets = [{
      label: a.label + ' to ' + b.label,
      data: rows.map(function (r) { return [Math.min(num(r[a.key]), num(r[b.key])), Math.max(num(r[a.key]), num(r[b.key]))]; }),
      backgroundColor: rows.map(function (r) { return hexAlpha(num(r[b.key]) >= num(r[a.key]) ? b.colour : a.colour, 0.5); }),
      borderWidth: 0, maxBarThickness: 8, borderRadius: 4,
      $points: [{ key: a.key, colour: a.colour, label: a.label }, { key: b.key, colour: b.colour, label: b.label }]
    }];
    legendItems = [{ label: a.label, colour: a.colour, dot: true }, { label: b.label, colour: b.colour, dot: true }];
  } else if (meta.intervals) {
    beginAtZero = false;
    datasets = meta.intervals.map(function (iv) {
      return {
        label: iv.label,
        data: rows.map(function (r) { return [num(r[iv.lo_key]), num(r[iv.hi_key])]; }),
        backgroundColor: iv.colour ? hexAlpha(iv.colour, 0.7) : rows.map(function (r) { return hexAlpha(rowColour(r, meta), 0.6); }),
        borderWidth: 0, maxBarThickness: iv.thickness || 8, grouped: false, borderRadius: 2,
        $points: iv.point_key ? [{ key: iv.point_key, colour: '#1a1a1a', radius: 3.5 }] : []
      };
    });
  } else {
    var valueKey = meta.rows ? 'value' : meta.value_key;
    var cols = rows.map(function (r) { return rowColour(r, meta); });
    datasets = [{
      label: meta.title, data: rows.map(function (r) { return r[valueKey]; }),
      backgroundColor: cols.map(function (x) { return hexAlpha(x, 0.85); }), borderColor: cols, borderWidth: 1,
      borderRadius: 2, maxBarThickness: 18
    }];
  }

  var multi = !!(meta.series || meta.dumbbell || meta.intervals);
  var opts = {
    indexAxis: horizontal ? 'y' : 'x',
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: !!(meta.series || meta.intervals), position: 'bottom' },
      tooltip: {
        mode: multi ? 'index' : 'nearest', intersect: !multi,
        callbacks: {
          title: function (items) { var r = rows[items[0].dataIndex]; return String(r[labelKey]) + (horizontal ? '' : (meta.x_suffix || '')); },
          label: function (item) {
            var r = rows[item.dataIndex];
            if (meta.dumbbell) {
              var a = meta.dumbbell.a, b = meta.dumbbell.b;
              return [' ' + a.label + ': ' + fmtNum(r[a.key], 1, unit), ' ' + b.label + ': ' + fmtNum(r[b.key], 1, unit),
                      ' Change: ' + (num(r[b.key]) - num(r[a.key]) >= 0 ? '+' : '') + fmtNum(num(r[b.key]) - num(r[a.key]), 1, unit === '%' ? ' pp' : unit)];
            }
            if (meta.intervals) {
              var iv = meta.intervals[item.datasetIndex];
              return ' ' + iv.label + ': ' + fmtNum(r[iv.lo_key], 3) + ' to ' + fmtNum(r[iv.hi_key], 3);
            }
            var dp = meta.dp !== undefined ? meta.dp : (meta.series && meta.percent ? 1 : (unit ? 1 : 0));
            var txt = ' ' + (item.dataset.label || '') + ': ' + fmtNum(item.parsed[horizontal ? 'x' : 'y'], dp, unit);
            if (item.dataset.raw) txt += '  (' + fmtNum(item.dataset.raw[item.dataIndex]) + ' trips)';
            return txt;
          },
          afterBody: function (items) { return tipExtras(rows[items[0].dataIndex], meta); }
        }
      }
    },
    scales: {
      x: { stacked: !!meta.stacked, grid: { display: horizontal }, beginAtZero: horizontal ? beginAtZero : true,
           max: horizontal ? meta.max : undefined,
           title: { display: horizontal && !!meta.x_label, text: meta.x_label },
           ticks: { maxRotation: 0, autoSkip: !horizontal, maxTicksLimit: 10, callback: function (v) { return horizontal ? fmtNum(v, meta.intervals ? 1 : 0, unit) : this.getLabelForValue(v); } } },
      y: { stacked: !!meta.stacked, grid: { display: !horizontal }, beginAtZero: true,
           max: horizontal ? undefined : (meta.percent ? 100 : meta.max),
           ticks: { autoSkip: false, font: { size: horizontal ? 10 : 11 }, callback: function (v) { return horizontal ? this.getLabelForValue(v) : fmtNum(v, meta.dp ? 1 : 0, unit); } },
           title: { display: !horizontal && !!meta.y_label, text: meta.y_label } }
    }
  };
  var plugins = [pointsPlugin];
  if (meta.marker) plugins.push(markerPlugin);
  var ref = meta.ref_key ? (data || {})[meta.ref_key] : meta.ref_line;
  if (ref !== undefined && ref !== null) plugins.push(refLinePlugin);
  var chart = new Chart(canvas.getContext('2d'), { type: 'bar', data: { labels: labels, datasets: datasets }, options: opts, plugins: plugins });
  chart.$rows = rows;
  if (ref !== undefined && ref !== null) { chart.$refValue = ref; chart.$refAxis = horizontal ? 'x' : 'y'; }
  if (legendItems) c.body.appendChild(swatchLegend(legendItems));
  var lg = categoryLegend(meta);
  if (lg) c.body.appendChild(lg);
  function update(st) {
    if (!meta.marker || horizontal) return;
    var v = st[meta.marker];
    chart.$markerIndex = (v === null || v === undefined) ? -1 : rows.findIndex(function (r) { return String(r[meta.x_key]) === String(v); });
    chart.draw();
  }
  update(state);
  return { chart: chart, update: update };
};

// ── GENERIC 2: line (time series or numeric x) ────────────────────────────────
RENDERERS.line = function (container, data, meta, state) {
  var c = makeCard(meta, state);
  container.appendChild(c.card);
  if (!data || !data[meta.x_key]) { c.body.appendChild(el('div', 'card-empty', 'No data.')); return null; }
  var canvas = chartBox(c.body, 230);
  var xs = data[meta.x_key];
  var numeric = meta.x_type === 'number';
  var xUnit = meta.x_unit || '';
  var unit = meta.unit || '';
  var labels = xs.map(function (d) { return numeric ? fmtNum(d, 0, xUnit) : fmtMonth(d); });
  var datasets = meta.series.map(function (sr) {
    return {
      label: sr.label, data: data[sr.key], borderColor: sr.colour, backgroundColor: hexAlpha(sr.colour, meta.fill ? 0.55 : 0.1),
      fill: meta.fill ? (meta.stacked ? 'stack' : 'origin') : false, borderWidth: numeric ? 2.5 : 1.5, pointRadius: 0, tension: 0.15,
      stack: meta.stacked ? 'km' : undefined, yAxisID: 'y'
    };
  });
  var scales = {
    x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { display: false },
         title: { display: !!meta.x_label, text: meta.x_label } },
    y: { stacked: !!meta.stacked, beginAtZero: true, title: { display: !!meta.y_label, text: meta.y_label },
         ticks: { callback: function (v) { return fmtNum(v, numeric ? 1 : 0, unit); } } }
  };
  if (meta.secondary) {
    datasets.push({
      label: meta.secondary.label, data: data[meta.secondary.key], borderColor: meta.secondary.colour, backgroundColor: meta.secondary.colour,
      borderDash: [5, 3], borderWidth: 1.5, pointRadius: 0, fill: false, yAxisID: 'y2', stack: undefined, stepped: true
    });
    scales.y2 = { position: 'right', beginAtZero: true, grid: { display: false }, title: { display: true, text: meta.secondary.y_label || meta.secondary.label } };
  }
  var plugins = [markerPlugin];
  if (meta.ref_line !== undefined) plugins.push(refLinePlugin);
  var chart = new Chart(canvas.getContext('2d'), {
    type: 'line', data: { labels: labels, datasets: datasets },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom' },
        tooltip: { callbacks: {
          title: function (items) { var x = xs[items[0].dataIndex]; return numeric ? fmtNum(x, 0, xUnit) + (meta.x_label ? ' ' + meta.x_label : '') : fmtDate(x); },
          label: function (item) {
            var y2 = item.dataset.yAxisID === 'y2';
            return ' ' + item.dataset.label + ': ' + fmtNum(item.parsed.y, y2 ? 0 : (numeric ? 2 : 1), y2 ? '' : unit);
          }
        } }
      },
      scales: scales
    },
    plugins: plugins
  });
  if (meta.ref_line !== undefined) { chart.$refValue = meta.ref_line; chart.$refAxis = 'y'; }
  function update(st) {
    if (!meta.marker) return;
    chart.$markerIndex = lastIndexLE(xs, st[meta.marker]);
    chart.draw();
  }
  update(state);
  return { chart: chart, update: update };
};

// ── GENERIC 3: kpi tiles ──────────────────────────────────────────────────────
// data is an object; when meta.at_marker is set, data is the timeline object
// and the value shown is data[key][index of state[at_marker]]. Items come from
// meta.items or from a metadata object named by meta.items_from {file, field}.
RENDERERS.kpi = function (container, data, meta, state) {
  var c = makeCard(meta, state);
  container.appendChild(c.card);
  if (!data) { c.body.appendChild(el('div', 'card-empty', 'No data.')); return null; }
  var items = meta.items;
  if (meta.items_from) {
    var src = (DATA.files[meta.items_from.file] || {})[meta.items_from.field] || {};
    items = Object.keys(src).map(function (k) { return { key: k, label: src[k].label, unit: src[k].unit, dp: src[k].dp, title: src[k].desc }; });
  }
  var grid = el('div', 'kpi-grid' + (meta.compact ? ' compact' : ''));
  c.body.appendChild(grid);
  var cells = {};
  items.forEach(function (it) {
    var tile = el('div', 'kpi');
    if (it.colour) tile.style.borderLeftColor = it.colour;
    if (it.title) tile.title = it.title;
    var b = el('b'); var s = el('span', '', it.label);
    tile.appendChild(b); tile.appendChild(s); grid.appendChild(tile);
    cells[it.key] = b;
  });
  function update(st) {
    var idx = meta.at_marker ? lastIndexLE(data[meta.x_key || 'dates'], st[meta.at_marker]) : -1;
    items.forEach(function (it) {
      var v = meta.at_marker ? (data[it.key] ? data[it.key][idx] : null) : data[it.key];
      cells[it.key].textContent = fmtNum(v, it.dp, it.unit);
    });
  }
  update(state);
  return { chart: null, update: update };
};

// ── GENERIC 4: text (narrative card) ──────────────────────────────────────────
// Placeholders: {summary.key} (build summary), {note} (page.notes for the
// value of state[meta.note_state]), {note_<var>} (page.notes[var]), a control's
// state key ({census_var} -> its option label), else the layer's data object.
RENDERERS.text = function (container, data, meta, state) {
  var c = makeCard(meta, state);
  c.card.classList.add('card-text');
  container.appendChild(c.card);
  var notes = (DATA.manifest.page || {}).notes || {};
  var body = String(meta.body || '').replace(/\{([\w.]+)\}/g, function (m, key) {
    var v;
    if (key.indexOf('summary.') === 0) v = (DATA.manifest.summary || {})[key.slice(8)];
    else if (key === 'note') v = notes[state[meta.note_state]];
    else if (key.indexOf('note_') === 0) v = notes[key.slice(5)];
    else if (controlFor(key)) v = controlLabel(key, state);
    else v = data ? data[key] : undefined;
    if (v === undefined || v === null) return '–';
    return typeof v === 'number' ? fmtNum(v, Number.isInteger(v) ? 0 : 2) : String(v);
  });
  c.body.appendChild(el('p', '', body));
  return { chart: null, update: function () {} };
};

// ── GENERIC 5: table (rows held in a state key) ───────────────────────────────
// A compact list of the rows in state[meta.rows_from_state] (e.g. the k-means
// pairs picked on the scatter). Clicking a row calls focusPair(row).
RENDERERS.table = function (container, data, meta, state) {
  var c = makeCard(meta, state);
  container.appendChild(c.card);
  var rows = (state[meta.rows_from_state] || []).slice();
  if (!rows.length) { c.body.appendChild(el('div', 'card-empty', meta.empty || 'Nothing selected.')); return null; }
  if (meta.sort_key) rows.sort(function (a, b) { return num(b[meta.sort_key]) - num(a[meta.sort_key]); });
  var nc = rows.filter(function (r) { return r.c; }).length;
  var trips = rows.reduce(function (t, r) { return t + num(r.trips); }, 0);
  c.body.appendChild(el('div', 'table-sum',
    '<b>' + fmtNum(rows.length) + '</b> pairs · <b>' + fmtNum(nc) + '</b> commuter · <b>' + fmtNum(rows.length - nc) +
    '</b> non-commuter · <b>' + fmtNum(trips) + '</b> trips' +
    (rows.length > (meta.limit || 1e9) ? ' · busiest ' + meta.limit + ' listed' : '')));
  var wrap = el('div', 'table-wrap');
  var t = el('table', 'data-table');
  var head = el('tr');
  meta.columns.forEach(function (col) { head.appendChild(el('th', col.dp !== undefined ? 'num' : '', col.label)); });
  t.appendChild(el('thead')).appendChild(head);
  var tb = el('tbody');
  var cols = DATA.manifest.colours.corridor;
  rows.slice(0, meta.limit || rows.length).forEach(function (r) {
    var tr = el('tr');
    if (state.focusPair && state.focusPair.a === r.a && state.focusPair.b === r.b) tr.className = 'on';
    meta.columns.forEach(function (col) {
      var v = col.key === 'pair' ? shortName(r.a, 30) + ' ↔ ' + shortName(r.b, 30) : r[col.key];
      if (col.map) {
        var lab = col.map[String(v)] || v;
        v = '<i class="dot" style="background:' + (cols[lab] || '#999') + '"></i>' + lab;
      } else if (col.dp !== undefined) {
        v = fmtNum(v, col.dp, col.unit);
      }
      var td = el('td', col.dp !== undefined ? 'num' : '', v);
      if (col.key === 'pair') td.title = r.a + ' ↔ ' + r.b;
      tr.appendChild(td);
    });
    tr.addEventListener('click', bindSec(function () { focusPair(r); }));
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  wrap.appendChild(t);
  c.body.appendChild(wrap);
  return { chart: null, update: function () {} };
};

// ── GENERIC 6: scatter (Plotly, loaded on first use) ──────────────────────────
// Rows with numeric metrics (meta.metrics_from: {key: {label, note}}); the
// viewer switches 1 to 3 metrics on:
//   1 metric  -> strip plot, one band per colour group (lasso/box select)
//   2 metrics -> 2D scatter (lasso/box select)
//   3 metrics -> 3D scatter (drag to rotate; click a point; range sliders
//                select a region, since Plotly has no 3D lasso)
// Selections go to setPairs() (app.js) under state[meta.select]; the handle's
// highlight(rows, focus) restyles points when the selection changes elsewhere.
var PLOTLY_SRC = 'https://cdn.jsdelivr.net/npm/plotly.js-gl3d-dist-min@2.35.2/plotly-gl3d.min.js';
var plotlyReady = null;
function loadPlotly() {
  if (window.Plotly) return Promise.resolve(window.Plotly);
  if (!plotlyReady) {
    plotlyReady = new Promise(function (resolve, reject) {
      var sc = document.createElement('script');
      sc.src = PLOTLY_SRC; sc.async = true;
      sc.onload = function () { resolve(window.Plotly); };
      sc.onerror = function () { reject(new Error('Plotly failed to load')); };
      document.head.appendChild(sc);
    });
  }
  return plotlyReady;
}

RENDERERS.scatter = function (container, data, meta, state) {
  // Plotly events arrive after this function returns, so handlers are bound
  // to the section now rather than when they are attached.
  var sec = SEC;
  var inThis = function (fn) { return function () { var a = arguments; return inSec(sec, function () { return fn.apply(null, a); }); }; };
  var rows = Array.isArray(data) ? data : [];
  var file = DATA.files[meta.file] || {};
  var metrics = file[meta.metrics_from] || {};
  var keys = Object.keys(metrics);
  var on = keys.slice(0, 2);                 // start in 2D: the dissertation's view
  if (keys.indexOf('peak') >= 0 && keys.indexOf('rev') >= 0) on = ['peak', 'rev'];
  var groups = Object.keys(meta.colour_map).sort();   // '0' then '1': commuter drawn on top
  var ext = {};
  keys.forEach(function (k) {
    var v = rows.map(function (r) { return num(r[k]); });
    var lo = Math.min.apply(null, v), hi = Math.max.apply(null, v), pad = (hi - lo) * 0.04;
    ext[k] = { lo: lo, hi: hi, range: [lo - pad, hi + pad] };
  });
  var ranges = {};                           // slider selection per metric
  keys.forEach(function (k) { ranges[k] = [ext[k].lo, ext[k].hi]; });
  var jitter = rows.map(function (r, i) { var x = Math.sin(i * 12.9898) * 43758.5453; return (x - Math.floor(x) - 0.5) * 0.7; });
  var selected = null;                       // Set of row indices, or null
  var focus = null;

  var card = el('div', 'card scatter-card');
  container.appendChild(card);
  var bar = el('div', 'sc-bar');
  bar.appendChild(el('span', 'lg-title', 'Metrics'));
  var chips = {};
  keys.forEach(function (k) {
    var b = el('button', 'chip', metrics[k].label);
    b.type = 'button'; b.title = metrics[k].note || '';
    b.addEventListener('click', function () {
      var i = on.indexOf(k);
      if (i >= 0) { if (on.length === 1) return; on.splice(i, 1); } else { on.push(k); on.sort(function (a, b2) { return keys.indexOf(a) - keys.indexOf(b2); }); }
      draw(true);
    });
    chips[k] = b; bar.appendChild(b);
  });
  var clearBtn = el('button', 'chip ghost', 'Clear selection');
  clearBtn.type = 'button';
  clearBtn.addEventListener('click', bindSec(function () { resetRanges(); setPairs([]); }));
  bar.appendChild(clearBtn);
  card.appendChild(bar);
  var plot = el('div', 'sc-plot');
  plot.appendChild(el('div', 'card-empty', 'Loading the chart…'));
  card.appendChild(plot);
  var note = el('div', 'chart-note sc-note');
  card.appendChild(note);
  var sliders = el('div', 'sc-sliders');
  card.appendChild(sliders);
  card.appendChild(swatchLegend(groups.slice().reverse().map(function (g) {
    return { label: (meta.colour_labels || {})[g] || g, colour: meta.colour_map[g], dot: true };
  })));

  function label(r) { return (meta.label_keys || []).map(function (k) { return r[k]; }).join(' ↔ '); }
  function tip(r) {
    var t = '<b>' + label(r) + '</b><br>' + ((meta.colour_labels || {})[String(r[meta.colour_key])] || '');
    keys.forEach(function (k) { t += '<br>' + metrics[k].label + ': ' + fmtNum(r[k], 2); });
    (meta.tip_keys || []).forEach(function (tk) { t += '<br>' + tk.label + ': ' + fmtNum(r[tk.key], tk.dp || 0); });
    return t;
  }
  var tips = rows.map(tip);

  function colourOf(i, g) {
    var hex = meta.colour_map[g];
    if (focus !== null && i === focus) return '#fdd522';
    if (!selected) return hexAlpha(hex, 0.7);
    return selected.has(i) ? hexAlpha(hex, 0.95) : hexAlpha(hex, 0.1);
  }

  function traces() {
    var d3 = on.length === 3;
    return groups.map(function (g) {
      var idx = [];
      rows.forEach(function (r, i) { if (String(r[meta.colour_key]) === g) idx.push(i); });
      var tr = {
        name: (meta.colour_labels || {})[g] || g,
        type: d3 ? 'scatter3d' : 'scatter',
        mode: 'markers',
        customdata: idx,
        text: idx.map(function (i) { return tips[i]; }),
        hovertemplate: '%{text}<extra></extra>',
        marker: {
          color: idx.map(function (i) { return colourOf(i, g); }),
          size: idx.map(function (i) { return i === focus ? (d3 ? 7 : 12) : (selected && selected.has(i) ? (d3 ? 4 : 8) : (d3 ? 3 : 6)); }),
          line: { width: 0 }
        }
      };
      if (on.length === 1) {
        tr.x = idx.map(function (i) { return rows[i][on[0]]; });
        tr.y = idx.map(function (i) { return +g + jitter[i]; });
      } else {
        tr.x = idx.map(function (i) { return rows[i][on[0]]; });
        tr.y = idx.map(function (i) { return rows[i][on[1]]; });
        if (d3) tr.z = idx.map(function (i) { return rows[i][on[2]]; });
      }
      return tr;
    });
  }

  function axis(k) {
    return { title: { text: metrics[k].label, font: { size: 11 } }, range: ext[k].range, zeroline: false, gridcolor: '#eceff3' };
  }

  function layout() {
    var base = {
      margin: { l: 56, r: 12, t: 8, b: 48 }, showlegend: false, hovermode: 'closest',
      font: { family: "'Roboto', system-ui, sans-serif", size: 11, color: '#5e5e5e' },
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
      uirevision: on.join('|'), dragmode: on.length === 3 ? 'turntable' : 'lasso'
    };
    if (on.length === 1) {
      base.xaxis = axis(on[0]);
      base.yaxis = { range: [-0.6, 1.6], tickvals: groups.map(Number), ticktext: groups.map(function (g) { return (meta.colour_labels || {})[g] || g; }), zeroline: false, fixedrange: true };
    } else if (on.length === 2) {
      base.xaxis = axis(on[0]); base.yaxis = axis(on[1]);
    } else {
      base.margin = { l: 0, r: 0, t: 0, b: 0 };
      base.scene = { xaxis: axis(on[0]), yaxis: axis(on[1]), zaxis: axis(on[2]), aspectmode: 'cube',
                     camera: { eye: { x: 1.6, y: -1.6, z: 0.9 } } };
    }
    return base;
  }

  function hint() {
    note.textContent = on.length === 3
      ? 'Drag to rotate, scroll to zoom. Click a point to pick one pair, or drag the sliders below to pick a region.'
      : 'Click a point to pick one pair, or drag a lasso around a group (double-click to clear). Switch on a third metric for 3D.';
    keys.forEach(function (k) { chips[k].classList.toggle('on', on.indexOf(k) >= 0); });
  }

  // Range sliders: two thumbs per active metric (3D only).
  function drawSliders() {
    clear(sliders);
    sliders.hidden = on.length !== 3;
    if (on.length !== 3) return;
    on.forEach(function (k) {
      var row = el('div', 'sc-range');
      row.appendChild(el('span', 'sc-range-label', metrics[k].label));
      var lo = el('input'), hi = el('input');
      [lo, hi].forEach(function (inp, j) {
        inp.type = 'range'; inp.min = ext[k].lo; inp.max = ext[k].hi; inp.step = (ext[k].hi - ext[k].lo) / 200;
        inp.value = ranges[k][j];
        inp.setAttribute('aria-label', metrics[k].label + (j ? ' maximum' : ' minimum'));
      });
      var out = el('span', 'sc-range-val');
      var show = function () { out.textContent = fmtNum(ranges[k][0], 2) + ' to ' + fmtNum(ranges[k][1], 2); };
      var onInput = bindSec(function () {
        var a = +lo.value, b = +hi.value;
        ranges[k] = [Math.min(a, b), Math.max(a, b)];
        show();
        applyRanges();
      });
      lo.addEventListener('input', onInput); hi.addEventListener('input', onInput);
      var pair = el('div', 'sc-thumbs'); pair.appendChild(lo); pair.appendChild(hi);
      row.appendChild(pair); row.appendChild(out); show();
      sliders.appendChild(row);
    });
  }
  function resetRanges() { keys.forEach(function (k) { ranges[k] = [ext[k].lo, ext[k].hi]; }); drawSliders(); }
  function rangesActive() {
    return on.some(function (k) { return ranges[k][0] > ext[k].lo + 1e-9 || ranges[k][1] < ext[k].hi - 1e-9; });
  }
  var rangeTimer = null;
  function applyRanges() {
    clearTimeout(rangeTimer);
    rangeTimer = setTimeout(bindSec(function () {
      if (!rangesActive()) { setPairs([]); return; }
      setPairs(rows.filter(function (r) {
        return on.every(function (k) { return r[k] >= ranges[k][0] && r[k] <= ranges[k][1]; });
      }));
    }), 120);
  }

  var ready = false;
  // Plotly.react clears the lasso and fires its own deselect/selected events;
  // those must not be read as the viewer changing the selection (that wiped
  // every lasso selection straight after it was made).
  var quiet = false;
  function draw(newMode) {
    hint();
    if (newMode) { drawSliders(); }
    if (!ready) return;
    quiet = true;
    Promise.resolve(Plotly.react(plot, traces(), layout(), { displaylogo: false, responsive: true,
      modeBarButtonsToRemove: ['toImage', 'sendDataToCloud', 'resetCameraLastSave3d', 'hoverClosest3d', 'hoverClosestCartesian', 'hoverCompareCartesian', 'toggleSpikelines'] }))
      .then(function () { setTimeout(function () { quiet = false; }, 0); });
  }

  function pickedRows(ev) {
    var idx = {};
    ((ev && ev.points) || []).forEach(function (p) {
      var i = Array.isArray(p.customdata) ? p.customdata[0] : p.customdata;
      if (i === undefined) i = p.data.customdata[p.pointNumber];
      idx[i] = 1;
    });
    return Object.keys(idx).map(function (i) { return rows[+i]; });
  }

  loadPlotly().then(function () {
    clear(plot);
    ready = true;
    draw(true);
    plot.on('plotly_click', inThis(function (ev) {
      if (quiet) return;
      var picked = pickedRows({ points: (ev.points || []).slice(0, 1) });
      if (!picked.length) return;
      setPairs(picked);
      focusPair(picked[0]);
    }));
    // Lasso / box: every point inside is selected and its route drawn.
    plot.on('plotly_selected', inThis(function (ev) {
      if (quiet || !ev || !ev.points || !ev.points.length) return;
      setPairs(pickedRows(ev));
    }));
    // Double-click on empty plot clears (as Plotly's own reset does).
    plot.on('plotly_doubleclick', inThis(function () { if (!quiet) setPairs([]); }));
  }).catch(function (err) {
    clear(plot);
    plot.appendChild(el('div', 'card-empty', 'The scatter plot could not load (' + err.message + ').'));
  });
  hint(); drawSliders();

  var byKey = {};
  rows.forEach(function (r, i) { byKey[r.a + '|' + r.b] = i; });
  return {
    chart: null,
    update: function () {},
    highlight: function (sel, focusRow) {
      selected = sel && sel.length ? new Set(sel.map(function (r) { return byKey[r.a + '|' + r.b]; })) : null;
      focus = focusRow ? byKey[focusRow.a + '|' + focusRow.b] : null;
      if (!sel || !sel.length) { if (rangesActive() && on.length === 3) { resetRanges(); } }
      draw(false);
    }
  };
};
