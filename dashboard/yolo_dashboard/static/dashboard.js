(() => {
  const $ = (id) => document.getElementById(id);
  const number = (value) => Number(value || 0).toLocaleString('en-IN');
  let dashboardData = null;
  let toastTimer = null;

  const DONUT_COLORS = ['#537cf5', '#4bc5ad', '#8b72e8', '#e99a59', '#38aac6', '#db83ae', '#94a3b8'];

  const esc = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));

  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function animateValue(el, targetNum, suffix = '') {
    const target = Number(targetNum || 0);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !Number.isFinite(target)) {
      el.textContent = number(target) + suffix;
      return;
    }
    const start = performance.now();
    const dur = 500;
    function frame(now) {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = number(Math.round(target * eased)) + suffix;
      if (p < 1) requestAnimationFrame(frame);
      else el.textContent = number(target) + suffix;
    }
    requestAnimationFrame(frame);
  }

  /* KPI Mini Visuals */
  function svgRing(pct, strokeColor, trackColor = '#e8eef9') {
    const clamped = Math.max(0, Math.min(100, Number(pct || 0)));
    const r = 17;
    const c = 2 * Math.PI * r;
    const offset = c - (clamped / 100) * c;
    return `<svg viewBox="0 0 44 44">
      <circle cx="22" cy="22" r="${r}" fill="none" stroke="${trackColor}" stroke-width="4"/>
      <circle class="ring-progress" cx="22" cy="22" r="${r}" fill="none" stroke="${strokeColor}" stroke-width="4"
        stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"
        transform="rotate(-90 22 22)"/>
      <text x="22" y="25" text-anchor="middle" fill="#2c3c58" font-size="9.5" font-weight="800">${Math.round(clamped)}%</text>
    </svg>`;
  }

  function svgMiniSpark(series, strokeColor = '#537cf5') {
    if (!series || !series.length) return '';
    const W = 58, H = 36, pad = 3;
    const vals = series.map((d) => d.count);
    const max = Math.max(1, ...vals);
    const pts = vals.map((v, i) => {
      const x = pad + (vals.length === 1 ? (W - 2 * pad) / 2 : (i * (W - 2 * pad)) / (vals.length - 1));
      const y = H - pad - (v / max) * (H - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return `<svg viewBox="0 0 ${W} ${H}">
      <polyline class="spark-line-anim" points="${pts}" fill="none" stroke="${strokeColor}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  function svgMiniPhoneVisual(count) {
    const active = Number(count || 0) > 0;
    const barHeights = active ? [12, 20, 28, 16] : [6, 6, 6, 6];
    const barColor = active ? '#e69553' : '#d5e0f4';
    return `<svg viewBox="0 0 58 36">
      ${barHeights.map((h, i) => `<rect class="bar-anim" style="animation-delay:${i * 45}ms" x="${10 + i * 10}" y="${32 - h}" width="6" height="${h}" rx="2.5" fill="${i === 2 && active ? '#537cf5' : barColor}"/>`).join('')}
    </svg>`;
  }

  function svgMiniHourlyBars(hourly, peakColor = '#e69553') {
    if (!hourly || !hourly.length) return '';
    const W = 58, H = 36;
    const step = W / 12;
    const buckets = [];
    for (let i = 0; i < 24; i += 2) {
      buckets.push((hourly[i]?.count || 0) + (hourly[i + 1]?.count || 0));
    }
    const bMax = Math.max(1, ...buckets);
    const peakIdx = buckets.indexOf(Math.max(...buckets));
    return `<svg viewBox="0 0 ${W} ${H}">
      ${buckets.map((v, idx) => {
        const bh = Math.max(3, (v / bMax) * (H - 4));
        const fill = idx === peakIdx ? peakColor : '#d5e0f4';
        return `<rect class="bar-anim" style="animation-delay:${idx * 25}ms" x="${(idx * step + 0.8).toFixed(1)}" y="${(H - bh).toFixed(1)}" width="${(step - 1.6).toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5" fill="${fill}"/>`;
      }).join('')}
    </svg>`;
  }

  /* Multi-Segment SVG Donut Charts */
  function renderDonut(container, items, centerLabel) {
    if (!items || !items.length) {
      container.innerHTML = '<div class="chart-loading">No records available</div>';
      return;
    }
    const total = items.reduce((sum, x) => sum + (x.count || 0), 0) || 1;
    const r = 44;
    const c = 2 * Math.PI * r;
    let accum = 0;
    const segments = items.map((item, idx) => {
      const frac = item.count / total;
      const len = Math.max(0, frac * c);
      const offset = -accum;
      accum += len;
      const color = DONUT_COLORS[idx % DONUT_COLORS.length];
      return `<circle class="donut-seg" cx="60" cy="60" r="${r}" fill="none" stroke="${color}" stroke-width="15"
        stroke-dasharray="${len.toFixed(2)} ${(c - len).toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"
        transform="rotate(-90 60 60)"><title>${esc(item.name)}: ${number(item.count)} (${Math.round(frac * 100)}%)</title></circle>`;
    }).join('');

    const legend = items.slice(0, 6).map((item, idx) => {
      const pct = ((item.count / total) * 100).toFixed(1);
      const color = DONUT_COLORS[idx % DONUT_COLORS.length];
      return `<div class="donut-legend-row">
        <div class="donut-legend-left"><i class="donut-swatch" style="background:${color}"></i><span>${esc(item.name)}</span></div>
        <span class="donut-legend-val">${number(item.count)} (${pct}%)</span>
      </div>`;
    }).join('');

    container.innerHTML = `
      <div class="donut-svg-wrap">
        <svg viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="${r}" fill="none" stroke="#edf1f8" stroke-width="15"/>
          ${segments}
          <text x="60" y="57" text-anchor="middle" fill="#1f2d47" font-size="14" font-weight="800">${number(total)}</text>
          <text x="60" y="71" text-anchor="middle" fill="#8b97ac" font-size="8.5" font-weight="700">${esc(centerLabel)}</text>
        </svg>
      </div>
      <div class="donut-legend">${legend}</div>`;
  }

  /* Main SVG Charts */
  function svgPeopleChart(series) {
    const W = 680, H = 200, left = 44, right = 14, top = 14, bottom = 32;
    const values = series.map((x) => x.count);
    const max = Math.max(1, ...values);
    const plotW = W - left - right;
    const plotH = H - top - bottom;
    const x = (i) => left + (series.length <= 1 ? plotW / 2 : (i * plotW) / (series.length - 1));
    const y = (v) => top + plotH - (v / max) * plotH * 0.86 - plotH * 0.04;
    const points = series.map((d, i) => `${x(i)},${y(d.count)}`).join(' ');
    const area = `${left},${top + plotH} ${points} ${left + plotW},${top + plotH}`;
    const grid = [0, 0.25, 0.5, 0.75, 1].map((t) => {
      const yy = top + plotH - t * plotH;
      return `<line x1="${left}" y1="${yy}" x2="${W - right}" y2="${yy}" stroke="#e9eef7" stroke-dasharray="3 5"/>
              <text x="${left - 8}" y="${yy + 3}" text-anchor="end" fill="#9aa6b8" font-size="9">${number(Math.round(max * t))}</text>`;
    }).join('');
    const labels = series.map((d, i) => `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" fill="#8f9cb0" font-size="9">${esc(d.label)}</text>`).join('');
    const dots = series.map((d, i) =>
      `<circle class="chart-dot" cx="${x(i)}" cy="${y(d.count)}" r="4.5" fill="#fff" stroke="#5a80f4" stroke-width="2.2" data-tip="${esc(d.label)}: ${number(d.count)} records" style="cursor:pointer"/>`
    ).join('');
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="People tracking records by day">
      ${grid}
      <defs>
        <linearGradient id="peopleArea" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="#7fa2ff" stop-opacity="0.32"/>
          <stop offset="1" stop-color="#7fa2ff" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      <polygon class="chart-area-anim" points="${area}" fill="url(#peopleArea)"/>
      <polyline class="chart-line-anim" points="${points}" fill="none" stroke="#5a80f4" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      ${dots}${labels}
    </svg><div class="chart-tooltip"></div>`;
  }

  function svgGateChart(series) {
    const W = 500, H = 160, left = 28, right = 10, top = 10, bottom = 28, plotH = H - top - bottom;
    const max = Math.max(1, ...series.flatMap((d) => [d.entries, d.exits]));
    const slot = (W - left - right) / Math.max(series.length, 1);
    const bw = Math.min(13, slot * 0.24);
    const grid = [0, 0.5, 1].map((t) => {
      const yy = top + plotH - t * plotH;
      return `<line x1="${left}" y1="${yy}" x2="${W - right}" y2="${yy}" stroke="#e9eef7" stroke-dasharray="3 5"/>`;
    }).join('');
    const bars = series.map((d, i) => {
      const cx = left + slot * i + slot / 2;
      const h1 = (d.entries / max) * plotH * 0.88;
      const h2 = (d.exits / max) * plotH * 0.88;
      const tip = `${esc(d.label)} · In: ${d.entries}, Out: ${d.exits}`;
      return `<rect class="bar-anim chart-dot" style="animation-delay:${i * 35}ms;cursor:pointer" x="${cx - bw - 2}" y="${top + plotH - h1}" width="${bw}" height="${h1}" rx="4" fill="#5b80f4" data-tip="${tip}"/>
              <rect class="bar-anim chart-dot" style="animation-delay:${i * 35 + 40}ms;cursor:pointer" x="${cx + 2}" y="${top + plotH - h2}" width="${bw}" height="${h2}" rx="4" fill="#4bc5ad" data-tip="${tip}"/>
              <text x="${cx}" y="${H - 7}" text-anchor="middle" fill="#8f9cb0" font-size="9">${esc(d.label)}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Vehicle gate entries and exits by day">${grid}${bars}</svg><div class="chart-tooltip"></div>`;
  }

  function svgHourlyChart(series, valueKey = 'count', barColor = '#5b80f4', peakColor = '#e69553') {
    const W = 620, H = 195, left = 36, right = 10, top = 12, bottom = 28, plotH = H - top - bottom;
    const vals = series.map((d) => d[valueKey] || 0);
    const max = Math.max(1, ...vals);
    const peakVal = Math.max(...vals);
    const slot = (W - left - right) / 24;
    const bw = Math.max(8, slot * 0.62);
    const grid = [0, 0.5, 1].map((t) => {
      const yy = top + plotH - t * plotH;
      return `<line x1="${left}" y1="${yy}" x2="${W - right}" y2="${yy}" stroke="#e9eef7" stroke-dasharray="3 5"/>
              <text x="${left - 6}" y="${yy + 3}" text-anchor="end" fill="#9aa6b8" font-size="9">${number(Math.round(max * t))}</text>`;
    }).join('');
    const bars = series.map((d, i) => {
      const val = d[valueKey] || 0;
      const cx = left + slot * i + slot / 2;
      const bh = val > 0 ? Math.max(3, (val / max) * plotH * 0.88) : 0;
      const fill = val === peakVal && val > 0 ? peakColor : barColor;
      const showLbl = i % 3 === 0;
      return `<rect class="bar-anim chart-dot" style="animation-delay:${i * 18}ms;cursor:pointer" x="${cx - bw / 2}" y="${top + plotH - bh}" width="${bw}" height="${bh}" rx="3.5" fill="${fill}" data-tip="${esc(d.label)}: ${number(val)}"/>` +
        (showLbl ? `<text x="${cx}" y="${H - 7}" text-anchor="middle" fill="#8f9cb0" font-size="9">${String(d.hour).padStart(2, '0')}h</text>` : '');
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}">${grid}${bars}</svg><div class="chart-tooltip"></div>`;
  }

  function svgGroupedHourlyGate(entriesArr, exitsArr) {
    const W = 620, H = 195, left = 32, right = 10, top = 12, bottom = 28, plotH = H - top - bottom;
    const max = Math.max(1, ...entriesArr, ...exitsArr);
    const slot = (W - left - right) / 24;
    const bw = Math.max(4, slot * 0.34);
    const grid = [0, 0.5, 1].map((t) => {
      const yy = top + plotH - t * plotH;
      return `<line x1="${left}" y1="${yy}" x2="${W - right}" y2="${yy}" stroke="#e9eef7" stroke-dasharray="3 5"/>
              <text x="${left - 6}" y="${yy + 3}" text-anchor="end" fill="#9aa6b8" font-size="9">${number(Math.round(max * t))}</text>`;
    }).join('');
    const bars = Array.from({ length: 24 }, (_, h) => {
      const en = entriesArr[h] || 0;
      const ex = exitsArr[h] || 0;
      const cx = left + slot * h + slot / 2;
      const h1 = en > 0 ? Math.max(3, (en / max) * plotH * 0.88) : 0;
      const h2 = ex > 0 ? Math.max(3, (ex / max) * plotH * 0.88) : 0;
      const tip = `${String(h).padStart(2, '0')}:00 · In: ${en}, Out: ${ex}`;
      return `<rect class="bar-anim chart-dot" style="animation-delay:${h * 15}ms;cursor:pointer" x="${cx - bw - 1}" y="${top + plotH - h1}" width="${bw}" height="${h1}" rx="2" fill="#5b80f4" data-tip="${tip}"/>
              <rect class="bar-anim chart-dot" style="animation-delay:${h * 15 + 20}ms;cursor:pointer" x="${cx + 1}" y="${top + plotH - h2}" width="${bw}" height="${h2}" rx="2" fill="#4bc5ad" data-tip="${tip}"/>` +
        (h % 3 === 0 ? `<text x="${cx}" y="${H - 7}" text-anchor="middle" fill="#8f9cb0" font-size="9">${String(h).padStart(2, '0')}h</text>` : '');
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}">${grid}${bars}</svg><div class="chart-tooltip"></div>`;
  }

  function svgCompareHourlyOverlay(dayA, dayB) {
    const W = 620, H = 200, left = 38, right = 12, top = 14, bottom = 28;
    const plotW = W - left - right;
    const plotH = H - top - bottom;
    const arrA = dayA.people_hourly || Array(24).fill(0);
    const arrB = dayB.people_hourly || Array(24).fill(0);
    const max = Math.max(1, ...arrA, ...arrB);
    const x = (i) => left + (i * plotW) / 23;
    const y = (v) => top + plotH - (v / max) * plotH * 0.88;

    const ptsA = arrA.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const ptsB = arrB.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const areaA = `${left},${top + plotH} ${ptsA} ${left + plotW},${top + plotH}`;

    const grid = [0, 0.5, 1].map((t) => {
      const yy = top + plotH - t * plotH;
      return `<line x1="${left}" y1="${yy}" x2="${W - right}" y2="${yy}" stroke="#e9eef7" stroke-dasharray="3 5"/>
              <text x="${left - 6}" y="${yy + 3}" text-anchor="end" fill="#9aa6b8" font-size="9">${number(Math.round(max * t))}</text>`;
    }).join('');
    const labels = [0, 3, 6, 9, 12, 15, 18, 21, 23].map((h) =>
      `<text x="${x(h)}" y="${H - 7}" text-anchor="middle" fill="#8f9cb0" font-size="9">${String(h).padStart(2, '0')}h</text>`
    ).join('');
    const dots = arrA.map((va, h) => {
      const vb = arrB[h] || 0;
      const tip = `${String(h).padStart(2, '0')}:00 · ${esc(dayA.label)}: ${number(va)} vs ${esc(dayB.label)}: ${number(vb)}`;
      return `<circle class="chart-dot" cx="${x(h)}" cy="${y(va)}" r="4" fill="#fff" stroke="#537cf5" stroke-width="2" data-tip="${tip}" style="cursor:pointer"/>`;
    }).join('');

    return `<svg viewBox="0 0 ${W} ${H}">
      ${grid}
      <defs>
        <linearGradient id="cmpAreaA" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="#537cf5" stop-opacity="0.22"/>
          <stop offset="1" stop-color="#537cf5" stop-opacity="0.01"/>
        </linearGradient>
      </defs>
      <polygon class="chart-area-anim" points="${areaA}" fill="url(#cmpAreaA)"/>
      <polyline class="chart-line-anim" points="${ptsB}" fill="none" stroke="#94a3b8" stroke-width="2.2" stroke-dasharray="4 4" stroke-linecap="round"/>
      <polyline class="chart-line-anim" points="${ptsA}" fill="none" stroke="#537cf5" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
      ${dots}${labels}
    </svg><div class="chart-tooltip"></div>`;
  }

  function wireChartTooltips(container) {
    const tipEl = container.querySelector('.chart-tooltip');
    if (!tipEl) return;
    container.querySelectorAll('.chart-dot').forEach((node) => {
      node.addEventListener('mouseenter', () => {
        tipEl.textContent = node.getAttribute('data-tip') || '';
        tipEl.classList.add('visible');
      });
      node.addEventListener('mouseleave', () => {
        tipEl.classList.remove('visible');
      });
    });
  }

  function renderBars(target, items, max, kind = 'status') {
    if (!items || !items.length) {
      target.innerHTML = '<div class="chart-loading">No records available</div>';
      return;
    }
    target.innerHTML = items.map((item) => {
      const pct = max ? Math.max(3, (item.count / max) * 100) : 0;
      if (kind === 'activity') {
        return `<div class="activity-row">
          <span class="activity-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.2"/><path d="M5 20c.4-4 2.7-6 7-6s6.6 2 7 6"/></svg></span>
          <span class="activity-name">${esc(item.name)}</span>
          <b class="activity-count">${number(item.count)}</b>
        </div>`;
      }
      const cls = kind === 'shutter' ? 'shutter-row' : 'status-row';
      const trackCls = kind === 'shutter' ? 'shutter-track' : 'row-track';
      const fillCls = kind === 'shutter' ? 'shutter-fill' : 'row-fill';
      return `<div class="${cls}">
        <span class="row-name">${esc(item.name)}</span>
        <span class="${trackCls}"><span class="${fillCls}" style="width:${pct}%"></span></span>
        <b class="row-value">${number(item.count)}</b>
      </div>`;
    }).join('');
  }

  function renderBayGrid(shutters) {
    const max = Math.max(1, ...shutters.map((s) => s.count));
    $('bayGrid').innerHTML = shutters.map((sh) => {
      const pct = Math.round((sh.count / max) * 100);
      return `<div class="bay-card">
        <div class="bay-head"><span>${esc(sh.name)}</span><span>${sh.share}%</span></div>
        <div class="bay-val">${number(sh.count)}</div>
        <div class="bay-meter"><div class="bay-fill" style="width:${pct}%"></div></div>
      </div>`;
    }).join('');
  }

  function buildHtmlTable(headers, rows) {
    if (!rows || !rows.length) {
      return '<div class="chart-loading">No records available for this metric.</div>';
    }
    return `<table class="data-table">
      <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;
  }

  /* Single Day Report Renderer */
  function renderSingleDayReport() {
    if (!dashboardData?.daily_breakdown?.length) return;
    const days = dashboardData.daily_breakdown;
    const dateVal = $('singleDaySelect').value;
    const day = days.find((d) => d.date === dateVal) || days[days.length - 1];

    $('singleDatePills').querySelectorAll('.date-pill').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.pickSingle === day.date);
    });

    $('singleDayKpis').innerHTML = `
      <article class="cmp-card"><div class="cmp-card-top"><span class="cmp-title">People tracking (${esc(day.label)})</span></div><div class="cmp-vals"><strong>${number(day.people_records)}</strong><span>${number(day.multi_cam_records)} multi-cam</span></div></article>
      <article class="cmp-card"><div class="cmp-card-top"><span class="cmp-title">Gate crossings (${esc(day.label)})</span></div><div class="cmp-vals"><strong>${number(day.gate_entries)} in</strong><span>/ ${number(day.gate_exits)} out</span></div></article>
      <article class="cmp-card"><div class="cmp-card-top"><span class="cmp-title">Warehouse updates (${esc(day.label)})</span></div><div class="cmp-vals"><strong>${number(day.warehouse_records)}</strong><span>${number(day.warehouse_docked)} docked · ${number(day.warehouse_parking)} parking</span></div></article>
      <article class="cmp-card"><div class="cmp-card-top"><span class="cmp-title">Carried &amp; phone (${esc(day.label)})</span></div><div class="cmp-vals"><strong>${number(day.carried_item_records)} bags</strong><span>· ${number(day.phone_usage_records || 0)} phone</span></div></article>`;

    const hourlySeries = (day.people_hourly || []).map((cnt, h) => ({ hour: h, label: `${String(h).padStart(2, '0')}:00`, count: cnt }));
    $('singlePeopleChartTitle').textContent = `People records by hour — ${day.label} (${day.date})`;
    $('singlePeakHourChip').innerHTML = `<i class="chip-dot blue"></i>Peak: ${esc(day.people_peak_hour)}`;
    $('singlePeopleHourlyChart').innerHTML = svgHourlyChart(hourlySeries, 'count', '#5b80f4', '#e69553');
    wireChartTooltips($('singlePeopleHourlyChart'));

    $('singleGateChartTitle').textContent = `Gate entries vs exits — ${day.label} (${day.date})`;
    $('singleGateHourlyChart').innerHTML = svgGroupedHourlyGate(day.gate_hourly_entries || [], day.gate_hourly_exits || []);
    wireChartTooltips($('singleGateHourlyChart'));

    $('singleActTitle').textContent = `Top activities on ${day.label}`;
    const acts = day.top_activities || [];
    renderBars($('singleDayActivities'), acts, Math.max(1, ...acts.map((a) => a.count)), 'status');

    $('singleFleetTitle').textContent = `Gate vehicle types on ${day.label}`;
    const vTypes = day.gate_vehicle_types || [];
    renderBars($('singleDayGateTypes'), vTypes, Math.max(1, ...vTypes.map((v) => v.count)), 'shutter');

    $('singleTableTitle').textContent = `Hourly activity table — ${day.label} (${day.date})`;
    const activeHours = [];
    for (let h = 0; h < 24; h += 1) {
      const pCnt = (day.people_hourly || [])[h] || 0;
      const gIn = (day.gate_hourly_entries || [])[h] || 0;
      const gOut = (day.gate_hourly_exits || [])[h] || 0;
      if (pCnt > 0 || gIn > 0 || gOut > 0) {
        activeHours.push([
          `${String(h).padStart(2, '0')}:00 – ${String((h + 1) % 24).padStart(2, '0')}:00`,
          number(pCnt),
          number(gIn),
          number(gOut),
          number(gIn + gOut),
        ]);
      }
    }
    $('singleDayTableWrap').innerHTML = buildHtmlTable(
      ['Hour Window', 'People Records', 'Gate Entries', 'Gate Exits', 'Total Gate Events'],
      activeHours
    );
  }

  /* Compare Two Dates (no Day A / Day B labels; prevents comparing same date) */
  function syncCompareDropdownOptions() {
    const selA = $('dayASelect');
    const selB = $('dayBSelect');
    if (selA.options.length < 2) return;

    if (selA.value === selB.value) {
      const alt = Array.from(selB.options).find((o) => o.value !== selA.value);
      if (alt) selB.value = alt.value;
    }
    Array.from(selA.options).forEach((opt) => {
      opt.disabled = opt.value === selB.value;
    });
    Array.from(selB.options).forEach((opt) => {
      opt.disabled = opt.value === selA.value;
    });
  }

  function formatDelta(a, b) {
    const diff = a - b;
    if (b === 0 && a === 0) return { text: '0%', cls: 'delta-flat' };
    if (b === 0) return { text: `+${number(a)}`, cls: 'delta-up' };
    const pct = Math.round((diff / b) * 100);
    if (diff > 0) return { text: `+${pct}%`, cls: 'delta-up' };
    if (diff < 0) return { text: `${pct}%`, cls: 'delta-down' };
    return { text: '0%', cls: 'delta-flat' };
  }

  function renderDayComparison() {
    if (!dashboardData?.daily_breakdown?.length) return;
    syncCompareDropdownOptions();

    const days = dashboardData.daily_breakdown;
    const dateA = $('dayASelect').value;
    const dateB = $('dayBSelect').value;
    const dayA = days.find((d) => d.date === dateA) || days[days.length - 1];
    const dayB = days.find((d) => d.date === dateB) || days[0];

    const labelA = `${dayA.label} (${dayA.date})`;
    const labelB = `${dayB.label} (${dayB.date})`;

    $('compareHourlyTitle').textContent = `Hourly people traffic: ${dayA.label} vs ${dayB.label}`;
    $('compareBarsTitle').textContent = `${dayA.label} vs ${dayB.label} — key counts`;
    $('cmpLegendA').textContent = dayA.label;
    $('cmpLegendB').textContent = dayB.label;
    $('cmpBarLegendA').textContent = dayA.label;
    $('cmpBarLegendB').textContent = dayB.label;

    const metrics = [
      { title: 'People tracking records', a: dayA.people_records, b: dayB.people_records },
      { title: 'Multi-camera tracks', a: dayA.multi_cam_records, b: dayB.multi_cam_records },
      { title: 'Gate entry events', a: dayA.gate_entries, b: dayB.gate_entries },
      { title: 'Gate exit events', a: dayA.gate_exits, b: dayB.gate_exits },
    ];

    $('compareDeltaGrid').innerHTML = metrics.map((m) => {
      const d = formatDelta(m.a, m.b);
      return `<article class="cmp-card">
        <div class="cmp-card-top">
          <span class="cmp-title">${esc(m.title)}</span>
          <span class="delta-pill ${d.cls}">${esc(d.text)}</span>
        </div>
        <div class="cmp-vals">
          <strong>${number(m.a)}</strong>
          <span>(${esc(dayA.label)}) vs ${number(m.b)} (${esc(dayB.label)})</span>
        </div>
      </article>`;
    }).join('');

    $('compareHourlyChart').innerHTML = svgCompareHourlyOverlay(dayA, dayB);
    wireChartTooltips($('compareHourlyChart'));

    const barMetrics = [
      { label: 'People records', a: dayA.people_records, b: dayB.people_records },
      { label: 'Multi-zone tracks', a: dayA.multi_cam_records, b: dayB.multi_cam_records },
      { label: 'Carried items', a: dayA.carried_item_records, b: dayB.carried_item_records },
      { label: 'Mobile phone usage', a: dayA.phone_usage_records || 0, b: dayB.phone_usage_records || 0 },
      { label: 'Gate entries', a: dayA.gate_entries, b: dayB.gate_entries },
      { label: 'Gate exits', a: dayA.gate_exits, b: dayB.gate_exits },
      { label: 'Warehouse updates', a: dayA.warehouse_records, b: dayB.warehouse_records },
    ];

    $('compareMetricBars').innerHTML = barMetrics.map((bm) => {
      const max = Math.max(1, bm.a, bm.b);
      return `<div class="cmp-bar-row">
        <div class="cmp-bar-head">
          <span>${esc(bm.label)}</span>
          <span>${esc(dayA.label)}: ${number(bm.a)} | ${esc(dayB.label)}: ${number(bm.b)}</span>
        </div>
        <div class="cmp-bar-pair">
          <div class="cmp-track"><div class="cmp-fill-a" style="width:${(bm.a / max) * 100}%"></div></div>
          <div class="cmp-track"><div class="cmp-fill-b" style="width:${(bm.b / max) * 100}%"></div></div>
        </div>
      </div>`;
    }).join('');

    const maxPeopleDay = Math.max(1, ...days.map((d) => d.people_records));
    $('dayMatrix').innerHTML = days.map((d) => `
      <div class="matrix-row ${d.date === dayA.date ? 'is-selected-a' : ''}" data-pick-day="${esc(d.date)}">
        <span class="matrix-day">${esc(d.label)}</span>
        <div class="matrix-bar-track"><div class="matrix-bar-fill" style="width:${(d.people_records / maxPeopleDay) * 100}%"></div></div>
        <span class="matrix-num">${number(d.people_records)}<small>People</small></span>
        <span class="matrix-num">${number(d.gate_entries)}/${number(d.gate_exits)}<small>In/Out</small></span>
        <span class="matrix-num">${number(d.warehouse_records)}<small>Yard</small></span>
      </div>`).join('');

    $('dayMatrix').querySelectorAll('[data-pick-day]').forEach((row) => {
      row.addEventListener('click', () => {
        const chosen = row.dataset.pickDay;
        if (chosen === $('dayBSelect').value) {
          const fallback = days.find((x) => x.date !== chosen);
          if (fallback) $('dayBSelect').value = fallback.date;
        }
        $('dayASelect').value = chosen;
        renderDayComparison();
      });
    });

    const renderActCol = (day, labelText, dotCls) => `
      <div class="act-col">
        <div class="act-col-head"><span class="cmp-dot ${dotCls}"></span>${esc(labelText)}</div>
        <div class="act-mini-list">
          ${(day.top_activities || []).map((a) => `<div class="act-mini-item"><span>${esc(a.name)}</span><b>${number(a.count)}</b></div>`).join('') || '<span class="chart-loading">No actions logged</span>'}
        </div>
      </div>`;

    $('compareActivities').innerHTML = renderActCol(dayA, labelA, 'cmp-a') + renderActCol(dayB, labelB, 'cmp-b');
  }

  function populateDaySelectors(days) {
    if (!days || !days.length) return;
    const opts = days.map((d) => `<option value="${esc(d.date)}">${esc(d.label)} (${esc(d.date)})</option>`).join('');
    $('singleDaySelect').innerHTML = opts;
    $('dayASelect').innerHTML = opts;
    $('dayBSelect').innerHTML = opts;

    $('singleDatePills').innerHTML = days.map((d) =>
      `<button type="button" class="date-pill" data-pick-single="${esc(d.date)}">${esc(d.label)}</button>`
    ).join('');

    $('singleDatePills').querySelectorAll('[data-pick-single]').forEach((btn) => {
      btn.addEventListener('click', () => {
        $('singleDaySelect').value = btn.dataset.pickSingle;
        renderSingleDayReport();
      });
    });

    $('singleDaySelect').value = days[days.length - 1].date;
    $('dayASelect').value = days[days.length - 1].date;
    $('dayBSelect').value = days[Math.max(0, days.length - 2)].date;

    renderSingleDayReport();
    renderDayComparison();
  }

  /* KPI Drill-Down Modal */
  function openKpiModal(kpiKey) {
    if (!dashboardData) return;
    const d = dashboardData;
    const det = d.kpi_details || {};
    let kicker = 'KPI DETAILS';
    let title = '';
    let subtitle = '';
    let figure = '';
    let tableTitle = 'Detailed Breakdown';
    let visualHtml = '';
    let tableHtml = '';

    if (kpiKey === 'people') {
      kicker = 'PEOPLE TRACKING';
      title = 'People tracking records';
      subtitle = 'Camera track records by day (not unique individuals)';
      figure = number(d.people.tracked_records);
      visualHtml = svgPeopleChart(d.people.daily || []);
      tableTitle = 'Day-by-Day People Summary';
      tableHtml = buildHtmlTable(
        ['Date', 'Label', 'People Records', 'Multi-Camera', 'Carried Items', 'Phone Usage'],
        (d.daily_breakdown || []).map((row) => [row.date, row.label, number(row.people_records), number(row.multi_cam_records), number(row.carried_item_records), number(row.phone_usage_records || 0)])
      );
    } else if (kpiKey === 'multi_cam') {
      kicker = 'CROSS-ZONE MOVEMENT';
      title = 'Multi-camera tracks';
      subtitle = `${d.people.multi_cam_share}% of people records appeared across 2 or more cameras`;
      figure = number(d.people.multi_cam_records);
      visualHtml = `<div class="donut-layout" id="modalDonutSlot"></div>`;
      tableTitle = 'Recent Multi-Camera Tracks (No Personal IDs)';
      tableHtml = buildHtmlTable(
        ['First Seen', 'Camera Route', 'Zones Visited', 'Duration', 'Activity'],
        (det.multi_cam_samples || []).map((r) => [r.first_seen, r.route, r.zones, r.duration, r.activity])
      );
    } else if (kpiKey === 'carried') {
      kicker = 'CARRIED ITEMS';
      title = 'Tracks with bags / cases';
      subtitle = `${d.people.carried_item_share}% of tracking records flagged with carried gear`;
      figure = number(d.people.carried_item_records);
      visualHtml = `<div class="status-list" id="modalBarsSlot"></div>`;
      tableTitle = 'Recent Carried-Item Records';
      tableHtml = buildHtmlTable(
        ['First Seen', 'Camera', 'Carried Items', 'Activity', 'Duration'],
        (det.carried_samples || []).map((r) => [r.first_seen, r.camera, r.items, r.activity, r.duration])
      );
    } else if (kpiKey === 'peak_hour') {
      kicker = 'PEAK FOOT TRAFFIC';
      title = 'Busiest people hour';
      subtitle = `Highest hourly tracking volume recorded at ${d.people.peak_hour?.label}`;
      figure = d.people.peak_hour?.label || '—';
      visualHtml = svgHourlyChart(d.people.hourly || [], 'count', '#5b80f4', '#e69553');
      tableTitle = 'Top 10 Busiest Hours';
      tableHtml = buildHtmlTable(
        ['Hour Window', 'People Records', 'Gate Events', 'Share of People'],
        (det.top_hours || []).map((r) => [r.hour_window, number(r.people_count), number(r.gate_count), `${r.share}%`])
      );
    } else if (kpiKey === 'gate_entries') {
      kicker = 'MAIN GATE IN';
      title = 'Vehicle entry events';
      subtitle = 'Inward crossings logged at CH2 main gate';
      figure = number(d.gate.entries);
      visualHtml = svgGateChart(d.gate.daily || []);
      tableTitle = 'Recent Vehicle Entry Events (No Plates / IDs)';
      tableHtml = buildHtmlTable(
        ['Timestamp', 'Vehicle Type', 'Direction', 'Plate Side'],
        (det.gate_entry_samples || []).map((r) => [r.timestamp, r.vehicle_type, r.direction, r.plate_side])
      );
    } else if (kpiKey === 'gate_exits') {
      kicker = 'MAIN GATE OUT';
      title = 'Vehicle exit events';
      subtitle = `Outward crossings logged (event diff: ${d.gate.net_event_difference > 0 ? '+' : ''}${d.gate.net_event_difference}, not a live yard balance)`;
      figure = number(d.gate.exits);
      visualHtml = svgGateChart(d.gate.daily || []);
      tableTitle = 'Recent Vehicle Exit Events (No Plates / IDs)';
      tableHtml = buildHtmlTable(
        ['Timestamp', 'Vehicle Type', 'Direction', 'Plate Side'],
        (det.gate_exit_samples || []).map((r) => [r.timestamp, r.vehicle_type, r.direction, r.plate_side])
      );
    } else if (kpiKey === 'docked') {
      kicker = 'DOCKING OPERATIONS';
      title = 'Vehicles docked';
      subtitle = `${d.warehouse.docked_share}% of warehouse vehicle-state records`;
      figure = number(d.warehouse.docked_count);
      visualHtml = `<div class="shutter-list" id="modalShutterSlot"></div>`;
      tableTitle = 'Recent Docked Vehicle Records';
      tableHtml = buildHtmlTable(
        ['Updated At', 'Vehicle Type', 'Camera', 'Shutter', 'Status'],
        (det.docked_samples || []).map((r) => [r.updated_at, r.vehicle_type, r.camera, r.shutter, r.status])
      );
    } else if (kpiKey === 'parking') {
      kicker = 'PARKING OCCUPANCY';
      title = 'Parking-state records';
      subtitle = `${number(d.warehouse.in_parking_count)} In parking + ${number(d.warehouse.parked_count)} Parked state records`;
      figure = number(d.warehouse.parking_total);
      visualHtml = `<div class="donut-layout" id="modalDonutSlot"></div>`;
      tableTitle = 'Recent Parking-State Records';
      tableHtml = buildHtmlTable(
        ['Updated At', 'Status', 'Vehicle Type', 'Camera'],
        (det.parking_samples || []).map((r) => [r.updated_at, r.status, r.vehicle_type, r.camera])
      );
    } else if (kpiKey === 'phone') {
      kicker = 'SAFETY & COMPLIANCE';
      title = 'Mobile phone usage';
      subtitle = `${d.people.phone_usage_records} detection records flagged holding a phone (${d.people.phone_usage_share}% of tracks)`;
      figure = number(d.people.phone_usage_records);
      visualHtml = `<div class="donut-layout" id="modalDonutSlot"></div>`;
      tableTitle = 'All Detected Mobile Phone Usage Records';
      tableHtml = buildHtmlTable(
        ['First Seen', 'Last Seen', 'Duration', 'Camera Route', 'Zones Visited', 'Activity', 'Carried Items'],
        (det.phone_records || []).map((r) => [r.first_seen, r.last_seen, r.duration, r.camera, r.zones, r.activity, r.carried_items])
      );
    }

    $('kpiModalKicker').textContent = kicker;
    $('kpiModalTitle').textContent = title;
    $('kpiModalSubtitle').textContent = subtitle;
    $('kpiModalFigure').textContent = figure;
    $('kpiModalTableTitle').textContent = tableTitle;
    $('kpiModalVisual').innerHTML = visualHtml;
    $('kpiModalTableWrap').innerHTML = tableHtml;

    if (kpiKey === 'multi_cam') {
      renderDonut($('modalDonutSlot'), det.multi_cam_depth || [], 'DEPTH');
    } else if (kpiKey === 'carried') {
      const items = d.people.carried_items_breakdown || [];
      renderBars($('modalBarsSlot'), items, Math.max(1, ...items.map((x) => x.count)), 'status');
    } else if (kpiKey === 'docked') {
      const sh = d.warehouse.shutters || [];
      renderBars($('modalShutterSlot'), sh, Math.max(1, ...sh.map((x) => x.count)), 'shutter');
    } else if (kpiKey === 'parking') {
      renderDonut($('modalDonutSlot'), [
        { name: 'In parking', count: d.warehouse.in_parking_count },
        { name: 'Parked', count: d.warehouse.parked_count },
      ], 'PARKING');
    } else if (kpiKey === 'phone') {
      renderDonut($('modalDonutSlot'), d.people.phone_cameras || [], 'CAMERAS');
    } else {
      wireChartTooltips($('kpiModalVisual'));
    }

    $('kpiModalBackdrop').classList.add('is-open');
    $('kpiModalBackdrop').setAttribute('aria-hidden', 'false');
  }

  function closeKpiModal() {
    $('kpiModalBackdrop').classList.remove('is-open');
    $('kpiModalBackdrop').setAttribute('aria-hidden', 'true');
  }

  function render(data) {
    dashboardData = data;
    const period = data.period || {};
    $('periodText').textContent = period.from && period.to ? `${period.from} — ${period.to}` : 'No date range';
    if (data.caution) $('cautionText').textContent = data.caution;

    $('navDaysBadge').textContent = `${(data.daily_breakdown || []).length}d`;
    $('navPeopleBadge').textContent = number(data.people.tracked_records);
    $('navGateBadge').textContent = number(data.gate.total_events);
    $('navOpsBadge').textContent = number(data.warehouse.vehicle_records);

    // 9 Useful Visual KPIs
    animateValue($('kpiPeople'), data.people.tracked_records);
    $('visPeopleSpark').innerHTML = svgMiniSpark(data.people.daily || []);

    animateValue($('kpiMultiCam'), data.people.multi_cam_records);
    $('visMultiCamRing').innerHTML = svgRing(data.people.multi_cam_share, '#38aac6');
    $('kpiMultiCamFoot').textContent = `${data.people.multi_cam_share}% crossed 2+ camera zones`;

    animateValue($('kpiCarried'), data.people.carried_item_records);
    $('visCarriedRing').innerHTML = svgRing(data.people.carried_item_share, '#8c76e4');
    $('kpiCarriedFoot').textContent = `${data.people.carried_item_share}% carrying bag/pack/case`;

    $('kpiPeakHour').textContent = data.people.peak_hour?.label || '—';
    $('visPeakHourBars').innerHTML = svgMiniHourlyBars(data.people.hourly || [], '#e69553');
    $('kpiPeakHourFoot').textContent = `${number(data.people.peak_hour?.count)} tracks in peak hour`;

    const gateTotal = Math.max(1, data.gate.total_events || 0);
    const entryPct = (data.gate.entries / gateTotal) * 100;
    const exitPct = (data.gate.exits / gateTotal) * 100;

    animateValue($('kpiEntries'), data.gate.entries);
    $('visEntryRing').innerHTML = svgRing(entryPct, '#3cb58d');
    $('kpiEntriesFoot').textContent = `${Math.round(entryPct)}% of ${number(data.gate.total_events)} gate events`;

    animateValue($('kpiExits'), data.gate.exits);
    $('visExitRing').innerHTML = svgRing(exitPct, '#cf78a3');
    const diff = data.gate.net_event_difference || 0;
    $('kpiExitsFoot').textContent = `Event diff: ${diff > 0 ? '+' : ''}${number(diff)} (not live balance)`;

    animateValue($('kpiDocked'), data.warehouse.docked_count);
    $('visDockedRing').innerHTML = svgRing(data.warehouse.docked_share, '#5a7fe8');
    $('kpiDockedFoot').textContent = `${data.warehouse.docked_share}% of warehouse records`;

    animateValue($('kpiParking'), data.warehouse.parking_total);
    $('visParkingRing').innerHTML = svgRing(data.warehouse.parking_share, '#39a99d');
    $('kpiParkingFoot').textContent = `${number(data.warehouse.in_parking_count)} in parking + ${number(data.warehouse.parked_count)} parked`;

    const phoneCount = data.people.phone_usage_records || 0;
    const phoneShare = data.people.phone_usage_share || 0;
    const phoneCams = (data.people.phone_cameras || []).map((c) => `${c.name}: ${c.count}`).join(', ');
    animateValue($('kpiPhone'), phoneCount);
    $('visPhoneSignal').innerHTML = svgMiniPhoneVisual(phoneCount);
    $('kpiPhoneFoot').textContent = phoneCams
      ? `${phoneShare}% of tracks (${phoneCams})`
      : `${phoneShare}% of people tracking records`;

    // Overview Charts & Visual Donuts
    const peakDay = data.people.peak_day || {};
    $('peakDayChip').innerHTML = `<i class="chip-dot blue"></i>Peak: ${esc(peakDay.label || '—')} (${number(peakDay.count)})`;
    $('peopleChart').innerHTML = svgPeopleChart(data.people.daily || []);
    wireChartTooltips($('peopleChart'));

    $('gateChart').innerHTML = svgGateChart(data.gate.daily || []);
    wireChartTooltips($('gateChart'));
    $('flowEntries').textContent = number(data.gate.entries);
    $('flowExits').textContent = number(data.gate.exits);
    $('flowDiff').textContent = (diff > 0 ? '+' : '') + number(diff);

    $('warehouseTotal').textContent = `${number(data.warehouse.vehicle_records)} records`;
    renderDonut($('warehouseDonutWrap'), data.warehouse.status_counts || [], 'STATES');

    $('shutterTotalChip').textContent = `${number(data.warehouse.shutter_assigned_total)} assigned`;
    const maxShutter = Math.max(1, ...(data.warehouse.shutters || []).map((x) => x.count));
    renderBars($('shutterListOverview'), data.warehouse.shutters, maxShutter, 'shutter');

    renderDonut($('cameraDonutWrap'), data.people.entry_cameras || [], 'CAMERAS');

    // View 2: Day Reports (Single Day + Compare Two Dates)
    populateDaySelectors(data.daily_breakdown || []);

    // View 3: People
    $('peopleHourlyPeakChip').innerHTML = `<i class="chip-dot blue"></i>Peak: ${esc(data.people.peak_hour?.label || '—')}`;
    $('peopleHourlyChart').innerHTML = svgHourlyChart(data.people.hourly || [], 'count', '#6488f4', '#e69553');
    wireChartTooltips($('peopleHourlyChart'));
    renderBars($('activityList'), data.people.top_activities, 0, 'activity');
    renderBars($('entryCamList'), data.people.entry_cameras, Math.max(1, ...(data.people.entry_cameras || []).map((x) => x.count)), 'status');
    $('carriedTotalChip').textContent = `${number(data.people.carried_item_records)} tracks`;
    renderBars($('carriedList'), data.people.carried_items_breakdown, Math.max(1, ...(data.people.carried_items_breakdown || []).map((x) => x.count)), 'shutter');

    // View 4: Vehicles & Gate
    $('gateHourlyPeakChip').innerHTML = `<i class="chip-dot blue"></i>Peak: ${esc(data.gate.peak_hour?.label || '—')}`;
    $('gateHourlyChart').innerHTML = svgHourlyChart(data.gate.hourly || [], 'total', '#4bc5ad', '#5b80f4');
    wireChartTooltips($('gateHourlyChart'));
    renderDonut($('gateFleetDonutWrap'), data.gate.vehicle_types || [], 'GATE');
    renderBars($('warehouseTypeList'), data.warehouse.vehicle_types, Math.max(1, ...(data.warehouse.vehicle_types || []).map((x) => x.count)), 'shutter');

    $('plateReadable').textContent = `${number(data.gate.readable_plate_records)} / ${number(data.gate.total_events)}`;
    const percent = data.gate.total_events ? (data.gate.readable_plate_records / data.gate.total_events) * 100 : 0;
    $('plateBar').style.width = `${percent}%`;
    $('plateNote').textContent = percent === 0
      ? data.caution || 'No readable plate values were found in these files.'
      : 'Some plate values were readable in these files.';

    // View 5: Operations
    const maxStatus = Math.max(1, ...(data.warehouse.status_counts || []).map((x) => x.count));
    renderBars($('statusListOps'), data.warehouse.status_counts, maxStatus, 'status');
    $('shutterUnassignedNote').textContent = `${number(data.warehouse.shutter_unassigned_total)} vehicle records have no shutter assigned`;
    $('shutterAssignedBadge').textContent = `${number(data.warehouse.shutter_assigned_total)} assigned`;
    renderBayGrid(data.warehouse.shutters || []);
    $('notesList').innerHTML = (data.data_quality?.notes || []).map((n) => `<li>${esc(n)}</li>`).join('');

    $('lastUpdated').textContent = `Files last changed: ${(data.files || []).map((x) => x.updated_at).filter(Boolean).sort().slice(-1)[0] || 'not available'}`;
  }

  async function loadData() {
    $('refreshBtn').disabled = true;
    $('refreshBtn').classList.add('is-spinning');
    try {
      const response = await fetch('/yolo/api/summary', {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Could not load dashboard data');
      render(data);
    } catch (error) {
      toast(error.message);
    } finally {
      $('refreshBtn').disabled = false;
      $('refreshBtn').classList.remove('is-spinning');
    }
  }

  /* Single-Page Sidebar Switching + Collapsible Sidebar */
  const viewNames = {
    overview: 'Overview',
    daily: 'Day Reports',
    people: 'People Movement',
    vehicles: 'Vehicles & Gate',
    operations: 'Warehouse Operations',
  };

  function switchView(viewId) {
    document.querySelectorAll('.nav-link[data-view]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.view === viewId);
    });
    document.querySelectorAll('.view-pane[data-view-panel]').forEach((pane) => {
      pane.classList.toggle('active', pane.dataset.viewPanel === viewId);
    });
    $('activeViewCrumb').textContent = viewNames[viewId] || 'Overview';
    $('sidebar').classList.remove('is-mobile-open');
  }

  document.querySelectorAll('[data-view]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      switchView(el.dataset.view);
    });
  });

  $('sidebarToggleBtn').addEventListener('click', () => {
    if (window.innerWidth <= 900) {
      $('sidebar').classList.remove('is-mobile-open');
      return;
    }
    const collapsed = $('appShell').classList.toggle('sidebar-collapsed');
    $('sidebarToggleBtn').setAttribute('aria-expanded', String(!collapsed));
  });

  $('mobileMenuBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    $('sidebar').classList.toggle('is-mobile-open');
  });

  /* Day Reports Mode Switching + Selectors */
  $('dailyModeTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-daily-mode]');
    if (!btn) return;
    const mode = btn.dataset.dailyMode;
    $('dailyModeTabs').querySelectorAll('.mode-tab').forEach((tab) => {
      const active = tab === btn;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    $('singleDayPane').classList.toggle('active', mode === 'single');
    $('compareDatesPane').classList.toggle('active', mode === 'compare');
  });

  $('singleDaySelect').addEventListener('change', renderSingleDayReport);
  $('dayASelect').addEventListener('change', renderDayComparison);
  $('dayBSelect').addEventListener('change', renderDayComparison);

  /* KPI Card Click / Keyboard Drill-Down */
  document.querySelectorAll('.kpi-card[data-kpi]').forEach((card) => {
    card.addEventListener('click', () => openKpiModal(card.dataset.kpi));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openKpiModal(card.dataset.kpi);
      }
    });
  });

  $('closeKpiModalBtn').addEventListener('click', closeKpiModal);
  $('kpiModalBackdrop').addEventListener('click', (e) => {
    if (e.target === $('kpiModalBackdrop')) closeKpiModal();
  });

  /* Safe Markdown Formatter for Bullet Points + Bold Text */
  function appendInlineBold(parent, text) {
    const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
    parts.forEach((part) => {
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        const strong = document.createElement('strong');
        strong.textContent = part.slice(2, -2);
        parent.appendChild(strong);
      } else if (part) {
        parent.appendChild(document.createTextNode(part));
      }
    });
  }

  function renderStructuredAnswer(container, text) {
    container.replaceChildren();
    const lines = String(text || '').split(/\r?\n/);
    let currentList = null;

    lines.forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line) {
        currentList = null;
        return;
      }
      const bulletMatch = line.match(/^[-*•]\s+(.*)$/);
      if (bulletMatch) {
        if (!currentList) {
          currentList = document.createElement('ul');
          currentList.className = 'chat-bullets';
          container.appendChild(currentList);
        }
        const li = document.createElement('li');
        appendInlineBold(li, bulletMatch[1]);
        currentList.appendChild(li);
      } else {
        currentList = null;
        const p = document.createElement('p');
        appendInlineBold(p, line);
        container.appendChild(p);
      }
    });
  }

  /* Floating Right-Side AI Drawer + Outside-Click Close */
  function openAiDrawer() {
    $('aiDrawer').classList.add('is-open');
    $('aiDrawer').setAttribute('aria-hidden', 'false');
    $('aiTriggerBtn').classList.add('is-hidden');
    $('aiTriggerBtn').setAttribute('aria-expanded', 'true');
  }

  function closeAiDrawer() {
    $('aiDrawer').classList.remove('is-open');
    $('aiDrawer').setAttribute('aria-hidden', 'true');
    $('aiTriggerBtn').classList.remove('is-hidden');
    $('aiTriggerBtn').setAttribute('aria-expanded', 'false');
  }

  $('aiTriggerBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    openAiDrawer();
  });

  $('closeAiBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    closeAiDrawer();
  });

  document.addEventListener('click', (e) => {
    if ($('aiDrawer').classList.contains('is-open')) {
      if (!$('aiDrawer').contains(e.target) && !$('aiTriggerBtn').contains(e.target)) {
        closeAiDrawer();
      }
    }
    if ($('sidebar').classList.contains('is-mobile-open')) {
      if (!$('sidebar').contains(e.target) && !$('mobileMenuBtn').contains(e.target)) {
        $('sidebar').classList.remove('is-mobile-open');
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if ($('kpiModalBackdrop').classList.contains('is-open')) closeKpiModal();
      if ($('aiDrawer').classList.contains('is-open')) closeAiDrawer();
    }
  });

  function addMessage(role, content, loading = false) {
    const welcome = $('chatLog').querySelector('.chat-welcome');
    if (welcome) welcome.style.display = 'none';
    const item = document.createElement('div');
    item.className = `chat-message ${role}${loading ? ' loading' : ''}`;
    const avatar = document.createElement('span');
    avatar.className = 'message-avatar';
    avatar.textContent = role === 'user' ? 'YOU' : 'AI';
    const text = document.createElement('div');
    text.className = 'message-content';
    if (role === 'assistant' && !loading) {
      renderStructuredAnswer(text, content);
    } else {
      text.textContent = content;
    }
    item.append(avatar, text);
    $('chatLog').append(item);
    $('chatLog').scrollTop = $('chatLog').scrollHeight;
    return item;
  }

  function setRobotThinking(thinking) {
    $('robotStage').classList.toggle('is-thinking', thinking);
    $('robotFabStage').classList.toggle('is-thinking', thinking);
    $('robotStatusText').textContent = thinking ? 'Analyzing aggregate KPIs…' : 'Ready · Bullet insights';
  }

  async function ask(question) {
    const q = String(question || '').trim();
    if (!q) return;
    addMessage('user', q);
    $('chatInput').value = '';
    $('sendBtn').disabled = true;
    setRobotThinking(true);
    const pending = addMessage('assistant', 'Checking the dashboard data…', true);
    try {
      const response = await fetch('/yolo/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ message: q }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'AI assistant could not answer');
      renderStructuredAnswer(pending.querySelector('.message-content'), result.answer);
      pending.classList.remove('loading');
    } catch (error) {
      pending.querySelector('.message-content').textContent = error.message;
      pending.classList.remove('loading');
    } finally {
      $('sendBtn').disabled = false;
      setRobotThinking(false);
      $('chatLog').scrollTop = $('chatLog').scrollHeight;
    }
  }

  $('refreshBtn').addEventListener('click', loadData);
  $('chatForm').addEventListener('submit', (event) => {
    event.preventDefault();
    ask($('chatInput').value);
  });
  $('quickChips').addEventListener('click', (event) => {
    const button = event.target.closest('[data-question]');
    if (button) ask(button.dataset.question);
  });

  loadData();
  setInterval(loadData, 60000);
})();
