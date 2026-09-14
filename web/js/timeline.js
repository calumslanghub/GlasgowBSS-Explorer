// timeline.js — the slider bar under the map, in two modes:
//   'dates': phase 2 infrastructure timeline (monthly + epoch boundaries) -> S.date
//   'hours': phase 1 "standard day", 06:00-23:00 -> S.hour (null = all-day view)
// It owns no data: it sets state and asks app.js to refresh in place.

'use strict';

var TL = { mode: null, values: [], timer: null };

var TL_MODES = {
  dates: {
    values: function () { return DATA.files['infra_timeline.json'].dates; },
    label: function (v) { return fmtDate(v); },
    apply: function (v) { S.date = v; },
    initial: function () { return TL.values.length - 1; },
    interval: 180,
    hint: '',
    resettable: false
  },
  hours: {
    values: function () { var h = []; for (var i = 6; i <= 23; i++) h.push(i); return h; },
    label: function (v) { return (v === null ? 'Standard day' : (v < 10 ? '0' : '') + v + ':00'); },
    apply: function (v) { S.hour = v; },
    initial: function () { return 0; },
    interval: 700,
    hint: 'Press play to watch a standard day. Marker size = trips to or from the station in that hour; colour: <span class="hint-scale"></span> mostly ending here (red) to mostly starting here (blue).',
    resettable: true
  }
};

function initTimeline() {
  var slider = document.getElementById('tl-slider');
  slider.addEventListener('input', function () { setPosition(+slider.value); });
  document.getElementById('tl-play').addEventListener('click', togglePlay);
  document.getElementById('tl-reset').addEventListener('click', resetTimeline);
  // Phase 2 state must exist before the first render, even on other tabs.
  S.date = TL_MODES.dates.values().slice(-1)[0];
}

// Switch the bar to a mode ('dates' | 'hours') or hide it ('none').
function setTimelineMode(mode) {
  stopPlay();
  var bar = document.getElementById('timeline');
  if (TL.mode === 'hours' && mode !== 'hours') S.hour = null;
  TL.mode = mode === 'none' ? null : mode;
  bar.hidden = !TL.mode;
  if (!TL.mode) return;
  var spec = TL_MODES[TL.mode];
  TL.values = spec.values();
  var slider = document.getElementById('tl-slider');
  slider.max = TL.values.length - 1;
  document.getElementById('tl-reset').hidden = !spec.resettable;
  document.getElementById('tl-hint').innerHTML = spec.hint;
  drawTicks();
  if (TL.mode === 'dates') {
    var i = TL.values.indexOf(S.date);
    slider.value = i >= 0 ? i : spec.initial();
    document.getElementById('tl-date').textContent = spec.label(TL.values[+slider.value]);
  } else {
    slider.value = spec.initial();
    document.getElementById('tl-date').textContent = spec.label(S.hour);
  }
}

function drawTicks() {
  var box = document.getElementById('tl-ticks');
  clear(box);
  if (TL.mode !== 'dates') return;
  var t = DATA.files['infra_timeline.json'];
  var n = TL.values.length - 1;
  t.epochs.forEach(function (e) {
    var i = TL.values.indexOf(e.start);
    if (i <= 0) return;
    var tick = el('i');
    tick.style.left = (i / n * 100) + '%';
    tick.title = 'Infrastructure opened ' + fmtDate(e.start);
    box.appendChild(tick);
  });
}

function setPosition(i, silent) {
  if (!TL.mode) return;
  var spec = TL_MODES[TL.mode];
  var v = TL.values[i];
  spec.apply(v);
  document.getElementById('tl-slider').value = i;
  document.getElementById('tl-date').textContent = spec.label(v);
  if (!silent) refreshForSlider();
}

function resetTimeline() {
  stopPlay();
  if (TL.mode !== 'hours') return;
  S.hour = null;
  document.getElementById('tl-slider').value = 0;
  document.getElementById('tl-date').textContent = TL_MODES.hours.label(null);
  refreshForSlider();
}

function togglePlay() {
  if (TL.timer) { stopPlay(); return; }
  if (!TL.mode) return;
  var slider = document.getElementById('tl-slider');
  var start = +slider.value;
  var atEnd = start >= TL.values.length - 1;
  var fresh = TL.mode === 'hours' && S.hour === null;
  if (atEnd || fresh) { start = 0; setPosition(0); }
  document.getElementById('tl-play').innerHTML = '&#10074;&#10074;';
  TL.timer = setInterval(function () {
    var i = +slider.value + 1;
    if (i >= TL.values.length) { stopPlay(); return; }
    setPosition(i);
  }, TL_MODES[TL.mode].interval);
}

function stopPlay() {
  if (TL.timer) clearInterval(TL.timer);
  TL.timer = null;
  document.getElementById('tl-play').innerHTML = '&#9654;';
}
