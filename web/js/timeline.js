// timeline.js — the slider bar under a section's map, in two modes:
//   'dates': the infrastructure timeline (monthly + epoch boundaries) -> S.date
//   'hours': the station-flows "standard day", 06:00-23:00 -> S.hour
//            (null = the all-day view the markers return to after playing)
// Each section has its own bar (SEC.tl); it owns no data: it sets state and
// asks app.js to refresh in place.

'use strict';

var TL_MODES = {
  dates: {
    values: function () { return DATA.files['infra_timeline.json'].dates; },
    label: function (v) { return fmtDate(v); },
    apply: function (v) { S.date = v; },
    initial: function () { return SEC.tl.values.length - 1; },
    interval: 180,
    hint: function () { return ''; },
    resettable: false
  },
  hours: {
    values: function () { var h = []; for (var i = 6; i <= 23; i++) h.push(i); return h; },
    label: function (v) {
      var day = controlLabel('daytype', S);
      return v === null ? 'Standard day · ' + day : (v < 10 ? '0' : '') + v + ':00 · ' + day;
    },
    apply: function (v) { S.hour = v; },
    initial: function () { return 0; },
    interval: 700,
    hint: function (v) {
      var base = 'Press play to watch a standard ' + dayNoun() + ' (switch All days / Weekdays / Weekends in the legend, even while it plays). ' +
        'Marker size = trips per day to or from the station in that hour; colour: <span class="hint-scale"></span> mostly ending here (red) to mostly starting here (blue).';
      if (v === null || v === undefined) return base;
      return '<b>' + fmtNum(networkHourRate(v)) + ' trips started across the network per ' + dayNoun() + ' in this hour.</b> ' + base;
    },
    resettable: true
  }
};

function dayNoun() {
  return S.daytype === 'weekday' ? 'weekday' : S.daytype === 'weekend' ? 'weekend day' : 'day';
}

// Network-wide trips started per day in an hour, for the active day type.
function networkHourRate(hour) {
  var sp = DATA.files['system_profile.json'] || {};
  var row = (sp.rows || []).find(function (r) { return r.hour === hour; });
  if (!row) return null;
  if (S.daytype === 'weekday') return row.weekday;
  if (S.daytype === 'weekend') return row.weekend;
  var wd = dayCount('weekday'), we = dayCount('weekend');
  return (row.weekday * wd + row.weekend * we) / (wd + we);
}

function initTimeline() {
  SEC.tl = { mode: null, values: [], timer: null };
  var slider = secEl('tl-slider');
  slider.addEventListener('input', bindSec(function () { setPosition(+slider.value); }));
  secEl('tl-play').addEventListener('click', bindSec(togglePlay));
  secEl('tl-reset').addEventListener('click', bindSec(resetTimeline));
  // The scale bar is lifted by the slider's height (CSS --tl-h).
  var bar = secEl('timeline'), wrap = secEl('map-wrap');
  if (window.ResizeObserver) {
    new ResizeObserver(function () { wrap.style.setProperty('--tl-h', bar.offsetHeight + 'px'); }).observe(bar);
  }
  if (!STATE.date) STATE.date = TL_MODES.dates.values().slice(-1)[0];
}

// Switch the bar to a mode ('dates' | 'hours') or hide it ('none').
function setTimelineMode(mode) {
  stopPlay();
  var tl = SEC.tl;
  var bar = secEl('timeline');
  tl.mode = mode === 'none' ? null : mode;
  bar.hidden = !tl.mode;
  secEl('map-wrap').classList.toggle('with-timeline', !!tl.mode);
  if (!tl.mode) return;
  var spec = TL_MODES[tl.mode];
  tl.values = spec.values();
  var slider = secEl('tl-slider');
  slider.max = tl.values.length - 1;
  secEl('tl-reset').hidden = !spec.resettable;
  drawTicks();
  if (tl.mode === 'dates') {
    var i = tl.values.indexOf(S.date);
    slider.value = i >= 0 ? i : spec.initial();
  } else {
    slider.value = spec.initial();
  }
  showTimelineLabel();
}

function showTimelineLabel() {
  var tl = SEC.tl;
  if (!tl || !tl.mode) return;
  var spec = TL_MODES[tl.mode];
  var v = tl.mode === 'dates' ? tl.values[+secEl('tl-slider').value] : S.hour;
  secEl('tl-date').textContent = spec.label(v);
  secEl('tl-hint').innerHTML = spec.hint(v);
}

function drawTicks() {
  var box = secEl('tl-ticks');
  clear(box);
  if (SEC.tl.mode !== 'dates') return;
  var t = DATA.files['infra_timeline.json'];
  var n = SEC.tl.values.length - 1;
  t.epochs.forEach(function (e) {
    var i = SEC.tl.values.indexOf(e.start);
    if (i <= 0) return;
    var tick = el('i');
    tick.style.left = (i / n * 100) + '%';
    tick.title = 'Infrastructure opened ' + fmtDate(e.start);
    box.appendChild(tick);
  });
}

function setPosition(i, silent) {
  var tl = SEC.tl;
  if (!tl.mode) return;
  TL_MODES[tl.mode].apply(tl.values[i]);
  secEl('tl-slider').value = i;
  showTimelineLabel();
  if (!silent) refreshForSlider();
}

// Back to the all-day view: markers sized by all trips, default colours.
function resetTimeline() {
  stopPlay();
  if (SEC.tl.mode !== 'hours') return;
  S.hour = null;
  secEl('tl-slider').value = 0;
  showTimelineLabel();
  refreshForSlider();
}

function togglePlay() {
  var tl = SEC.tl;
  if (tl.timer) { stopPlay(); return; }
  if (!tl.mode) return;
  var slider = secEl('tl-slider');
  var atEnd = +slider.value >= tl.values.length - 1;
  var fresh = tl.mode === 'hours' && S.hour === null;
  if (atEnd || fresh) setPosition(0);
  secEl('tl-play').innerHTML = '&#10074;&#10074;';
  secEl('tl-play').setAttribute('aria-label', 'Pause');
  tl.timer = setInterval(bindSec(function () {
    var i = +slider.value + 1;
    if (i >= tl.values.length) {
      // The standard day ends by returning to the all-day view rather than
      // leaving every marker coloured as 23:00.
      if (tl.mode === 'hours') setTimeout(bindSec(resetTimeline), tl.mode ? TL_MODES.hours.interval : 0);
      stopPlay();
      return;
    }
    setPosition(i);
  }), TL_MODES[tl.mode].interval);
}

function stopPlay() {
  var tl = SEC.tl;
  if (tl && tl.timer) clearInterval(tl.timer);
  if (tl) tl.timer = null;
  var b = secEl('tl-play');
  if (b) { b.innerHTML = '&#9654;'; b.setAttribute('aria-label', 'Play'); }
}
