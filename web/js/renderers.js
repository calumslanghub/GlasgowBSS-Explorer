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
    rows = Array.isArray(data) ? data.slice() : [];
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
// (chart.$refValue on scale chart.$refAxis, 'x' or 'y').
var refLinePlugin = {
  id: 'refLine',
  beforeDatasetsDraw: function (chart) {
    var v = chart.$refValue;
    if (v === undefined || v === null) return;
    var scale = chart.scales[chart.$refAxis || 'x'];
    if (!scale) return;
    var ctx = chart.ctx, area = chart.chartArea;
    ctx.save(); ctx.strokeStyle = '#5e5e5e'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
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
  var c = makeCard(meta, state);
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
            var dp = meta.series && meta.percent ? 1 : (unit ? 1 : 0);
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
           ticks: { autoSkip: false, font: { size: horizontal ? 10 : 11 }, callback: function (v) { return horizontal ? this.getLabelForValue(v) : fmtNum(v, 0, unit); } },
           title: { display: !horizontal && !!meta.y_label, text: meta.y_label } }
    }
  };
  var plugins = [pointsPlugin];
  if (meta.marker) plugins.push(markerPlugin);
  if (meta.ref_line !== undefined) plugins.push(refLinePlugin);
  var chart = new Chart(canvas.getContext('2d'), { type: 'bar', data: { labels: labels, datasets: datasets }, options: opts, plugins: plugins });
  chart.$rows = rows;
  if (meta.ref_line !== undefined) { chart.$refValue = meta.ref_line; chart.$refAxis = horizontal ? 'x' : 'y'; }
  if (legendItems) c.body.appendChild(swatchLegend(legendItems));
  var lg = categoryLegend(meta);
  if (lg) c.body.appendChild(lg);
  function update(st) {
    if (!meta.marker || horizontal) return;
    var v = st[meta.marker];
    chart.$markerIndex = (v === null || v === undefined) ? -1 : rows.findIndex(function (r) { return r[meta.x_key] === v; });
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
// {key} placeholders read the layer's data object; {summary.key} reads the
// build summary in the manifest. Numbers are formatted with thousands separators.
RENDERERS.text = function (container, data, meta, state) {
  var c = makeCard(meta, state);
  c.card.classList.add('card-text');
  container.appendChild(c.card);
  var body = String(meta.body || '').replace(/\{([\w.]+)\}/g, function (m, key) {
    var v;
    if (key.indexOf('summary.') === 0) v = (DATA.manifest.summary || {})[key.slice(8)];
    else v = data ? data[key] : undefined;
    if (v === undefined || v === null) return '–';
    return typeof v === 'number' ? fmtNum(v, Number.isInteger(v) ? 0 : 2) : String(v);
  });
  c.body.appendChild(el('p', '', body));
  return { chart: null, update: function () {} };
};
