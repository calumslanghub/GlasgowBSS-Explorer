// timeline.js — phase 2 date slider + play button. Owns no data: it sets S.date
// and asks app.js to refresh. Slider positions are the timeline's date list
// (monthly + every infrastructure epoch boundary) so each step is a real date.

'use strict';

var TL = { timer: null, dates: [] };

function initTimeline() {
  var t = DATA.files['infra_timeline.json'];
  TL.dates = t.dates;
  var slider = document.getElementById('tl-slider');
  slider.max = TL.dates.length - 1;
  slider.value = TL.dates.length - 1;
  slider.addEventListener('input', function () { setDate(TL.dates[+slider.value]); });
  document.getElementById('tl-play').addEventListener('click', togglePlay);
  drawEpochTicks();
  setDate(TL.dates[TL.dates.length - 1], true);
}

function drawEpochTicks() {
  var box = document.getElementById('tl-epoch-ticks');
  clear(box);
  var t = DATA.files['infra_timeline.json'];
  var n = TL.dates.length - 1;
  t.epochs.forEach(function (e) {
    var i = TL.dates.indexOf(e.start);
    if (i <= 0) return;
    var tick = el('i');
    tick.style.left = (i / n * 100) + '%';
    tick.title = 'Infrastructure opened ' + fmtDate(e.start);
    box.appendChild(tick);
  });
}

function setDate(iso, silent) {
  S.date = iso;
  var i = TL.dates.indexOf(iso);
  if (i >= 0) document.getElementById('tl-slider').value = i;
  document.getElementById('tl-date').textContent = fmtDate(iso);
  if (!silent) refreshForDate();
}

function togglePlay() {
  if (TL.timer) { stopPlay(); return; }
  var slider = document.getElementById('tl-slider');
  if (+slider.value >= TL.dates.length - 1) slider.value = 0;
  document.getElementById('tl-play').innerHTML = '&#10074;&#10074;';
  TL.timer = setInterval(function () {
    var i = +slider.value + 1;
    if (i >= TL.dates.length) { stopPlay(); return; }
    slider.value = i;
    setDate(TL.dates[i]);
  }, 180);
}

function stopPlay() {
  clearInterval(TL.timer); TL.timer = null;
  document.getElementById('tl-play').innerHTML = '&#9654;';
}
