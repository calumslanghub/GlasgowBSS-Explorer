// renderers.js — the GENERIC renderers, chosen per layer by its `render` field.
//
//   bar   - Chart.js bar chart. Horizontal ranked lists (top destinations,
//           corridors, exposure by type) and vertical stacked/100% series
//           (hourly origin vs destination) are the SAME renderer, configured
//           by meta: orientation, series | value_key, label_key | x_key,
//           stacked, percent, colour | colour_key + colour_map, rows, max, unit.
//   line  - Chart.js multi-series time series (km open by type) with optional
//           stacked fill, a secondary-axis series and a vertical marker at a
//           state value (the slider date).
//   kpi   - stat tiles from an object (or from the timeline row at the marker).
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
  if (meta.rows) {
    return meta.rows.map(function (r) {
      return { label: r.label, value: data ? data[r.key] : null, colour: r.colour, key: r.key };
    });
  }
  return Array.isArray(data) ? data : [];
}

function barColours(rows, meta) {
  return rows.map(function (r) {
    if (r.colour) return r.colour;
    if (meta.colour_key && meta.colour_map) return meta.colour_map[r[meta.colour_key]] || '#b3b3b3';
    return meta.colour || '#0065bd';
  });
}

function categoryLegend(meta) {
  if (!(meta.colour_key && meta.colour_map)) return null;
  var lg = el('div', 'legend-inline');
  Object.keys(meta.colour_map).forEach(function (k) {
    lg.appendChild(el('span', '', '<i style="background:' + meta.colour_map[k] + '"></i>' + k));
  });
  return lg;
}

// ── GENERIC 1: bar ────────────────────────────────────────────────────────────
RENDERERS.bar = function (container, data, meta, state) {
  var c = makeCard(meta);
  container.appendChild(c.card);
  var horizontal = (meta.orientation || 'horizontal') === 'horizontal';
  var rows = rowsFromData(data, meta);
  if (!rows.length) { c.body.appendChild(el('div', 'card-empty', 'No data for this station.')); return null; }

  var height = horizontal ? Math.max(120, 22 * rows.length + 30) : 190;
  var canvas = chartBox(c.body, height);
  var labelKey = meta.label_key || (meta.rows ? 'label' : meta.x_key);
  var labels = rows.map(function (r) {
    var v = r[labelKey];
    return horizontal ? shortName(v) : (v + (meta.x_suffix || ''));
  });

  var datasets;
  if (meta.series) {
    // Multi-series (stacked / percent) — one dataset per series key.
    var totals = rows.map(function (r) {
      return meta.series.reduce(function (s, sr) { return s + (Number(r[sr.key]) || 0); }, 0);
    });
    datasets = meta.series.map(function (sr) {
      return {
        label: sr.label, backgroundColor: hexAlpha(sr.colour, 0.85), borderColor: sr.colour, borderWidth: 1,
        raw: rows.map(function (r) { return Number(r[sr.key]) || 0; }),
        data: rows.map(function (r, i) {
          var v = Number(r[sr.key]) || 0;
          return meta.percent ? (totals[i] ? +(v / totals[i] * 100).toFixed(1) : 0) : v;
        }),
        stack: meta.stacked ? 's' : undefined
      };
    });
  } else {
    var valueKey = meta.rows ? 'value' : meta.value_key;
    var cols = barColours(rows, meta);
    datasets = [{
      label: meta.title, data: rows.map(function (r) { return r[valueKey]; }),
      backgroundColor: cols.map(function (x) { return hexAlpha(x, 0.85); }), borderColor: cols, borderWidth: 1,
      borderRadius: 2, maxBarThickness: 18
    }];
  }

  var unit = meta.unit || (meta.percent ? '%' : '');
  var opts = {
    indexAxis: horizontal ? 'y' : 'x',
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: !!meta.series, position: 'bottom' },
      tooltip: {
        mode: meta.series ? 'index' : 'nearest', intersect: !meta.series,
        callbacks: {
          title: function (items) { var r = rows[items[0].dataIndex]; return String(r[labelKey]) + (horizontal ? '' : (meta.x_suffix || '')); },
          label: function (item) {
            var r = rows[item.dataIndex];
            var txt = ' ' + (item.dataset.label || '') + ': ' + fmtNum(item.parsed[horizontal ? 'x' : 'y'], meta.series && meta.percent ? 1 : (unit ? 1 : 0), unit);
            if (item.dataset.raw) txt += '  (' + fmtNum(item.dataset.raw[item.dataIndex]) + ' trips)';
            if (meta.share_key && r[meta.share_key] !== undefined) txt += '  ·  ' + fmtNum(r[meta.share_key], 1, '%') + ' of trips';
            if (meta.colour_key && r[meta.colour_key]) txt += '  ·  ' + r[meta.colour_key];
            return txt;
          }
        }
      }
    },
    scales: {
      x: { stacked: !!meta.stacked, grid: { display: horizontal }, beginAtZero: true,
           max: horizontal ? meta.max : undefined, ticks: { maxRotation: 0, autoSkip: !horizontal, maxTicksLimit: 10, callback: function (v) { return horizontal ? fmtNum(v, 0, unit) : this.getLabelForValue(v); } } },
      y: { stacked: !!meta.stacked, grid: { display: !horizontal }, beginAtZero: true,
           max: horizontal ? undefined : (meta.percent ? 100 : meta.max),
           ticks: { autoSkip: false, font: { size: horizontal ? 10 : 11 }, callback: function (v) { return horizontal ? this.getLabelForValue(v) : fmtNum(v, 0, unit); } },
           title: { display: !horizontal && !!meta.y_label, text: meta.y_label } }
    }
  };
  var chart = new Chart(canvas.getContext('2d'), { type: 'bar', data: { labels: labels, datasets: datasets }, options: opts });
  var lg = categoryLegend(meta);
  if (lg) c.body.appendChild(lg);
  return { chart: chart, update: null };
};

// ── GENERIC 2: line (time series) ─────────────────────────────────────────────
// Vertical marker plugin: draws a guide at the x index held in state[meta.marker].
var markerPlugin = {
  id: 'dateMarker',
  afterDatasetsDraw: function (chart) {
    var idx = chart.$markerIndex;
    if (idx === undefined || idx === null || idx < 0) return;
    var x = chart.scales.x.getPixelForValue(idx);
    var ctx = chart.ctx, area = chart.chartArea;
    ctx.save(); ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(x, area.top); ctx.lineTo(x, area.bottom); ctx.stroke(); ctx.restore();
  }
};

RENDERERS.line = function (container, data, meta, state) {
  var c = makeCard(meta);
  container.appendChild(c.card);
  if (!data || !data[meta.x_key]) { c.body.appendChild(el('div', 'card-empty', 'No data.')); return null; }
  var canvas = chartBox(c.body, 230);
  var xs = data[meta.x_key];
  var labels = xs.map(function (d) { return fmtMonth(d); });
  var datasets = meta.series.map(function (sr) {
    return {
      label: sr.label, data: data[sr.key], borderColor: sr.colour, backgroundColor: hexAlpha(sr.colour, meta.fill ? 0.55 : 0.1),
      fill: meta.fill ? (meta.stacked ? 'stack' : 'origin') : false, borderWidth: 1.5, pointRadius: 0, tension: 0.15, stack: meta.stacked ? 'km' : undefined, yAxisID: 'y'
    };
  });
  var scales = {
    x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { display: false } },
    y: { stacked: !!meta.stacked, beginAtZero: true, title: { display: !!meta.y_label, text: meta.y_label } }
  };
  if (meta.secondary) {
    datasets.push({
      label: meta.secondary.label, data: data[meta.secondary.key], borderColor: meta.secondary.colour, backgroundColor: meta.secondary.colour,
      borderDash: [5, 3], borderWidth: 1.5, pointRadius: 0, fill: false, yAxisID: 'y2', stack: undefined, stepped: true
    });
    scales.y2 = { position: 'right', beginAtZero: true, grid: { display: false }, title: { display: true, text: meta.secondary.y_label || meta.secondary.label } };
  }
  var chart = new Chart(canvas.getContext('2d'), {
    type: 'line', data: { labels: labels, datasets: datasets },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom' },
        tooltip: { callbacks: {
          title: function (items) { return fmtDate(xs[items[0].dataIndex]); },
          label: function (item) { return ' ' + item.dataset.label + ': ' + fmtNum(item.parsed.y, item.dataset.yAxisID === 'y2' ? 0 : 1, item.dataset.yAxisID === 'y2' ? '' : ' km'); }
        } }
      },
      scales: scales
    },
    plugins: [markerPlugin]
  });
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
// and the value shown is data[key][index of state[at_marker]].
RENDERERS.kpi = function (container, data, meta, state) {
  var c = makeCard(meta);
  container.appendChild(c.card);
  if (!data) { c.body.appendChild(el('div', 'card-empty', 'No data for this station.')); return null; }
  var grid = el('div', 'kpi-grid' + (meta.compact ? ' compact' : ''));
  c.body.appendChild(grid);
  var cells = {};
  meta.items.forEach(function (it) {
    var tile = el('div', 'kpi');
    if (it.colour) tile.style.borderLeftColor = it.colour;
    var b = el('b'); var s = el('span', '', it.label);
    tile.appendChild(b); tile.appendChild(s); grid.appendChild(tile);
    cells[it.key] = b;
  });
  function update(st) {
    var idx = meta.at_marker ? lastIndexLE(data[meta.x_key || 'dates'], st[meta.at_marker]) : -1;
    meta.items.forEach(function (it) {
      var v = meta.at_marker ? (data[it.key] ? data[it.key][idx] : null) : data[it.key];
      cells[it.key].textContent = fmtNum(v, it.dp, it.unit);
    });
  }
  update(state);
  return { chart: null, update: update };
};
