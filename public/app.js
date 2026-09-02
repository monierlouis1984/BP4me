/* BP4me — front-end. Readings are kept in localStorage; the only network
   call is POST /api/read, which sends a downscaled photo to the Worker. */
(() => {
  "use strict";

  // ---------- storage ----------
  const READINGS_KEY = "bp4me.readings.v1";
  const SETTINGS_KEY = "bp4me.settings.v1";

  const loadJSON = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };
  const saveJSON = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      toast("Could not save: storage is full or blocked.");
    }
  };

  let readings = loadJSON(READINGS_KEY, []).filter(isValidReading).sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  let settings = loadJSON(SETTINGS_KEY, {});

  function isValidReading(r) {
    return r && typeof r.ts === "string" && Number.isFinite(r.sys) && Number.isFinite(r.dia) && !Number.isNaN(Date.parse(r.ts));
  }
  function persist() {
    readings.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
    saveJSON(READINGS_KEY, readings);
    renderAll();
  }
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // ---------- categories (2017 ACC/AHA) ----------
  const CATEGORIES = {
    normal: { label: "Normal", cls: "badge-normal" },
    elevated: { label: "Elevated", cls: "badge-elevated" },
    stage1: { label: "Stage 1 hypertension", cls: "badge-stage1" },
    stage2: { label: "Stage 2 hypertension", cls: "badge-stage2" },
    crisis: { label: "Hypertensive crisis", cls: "badge-crisis" },
  };
  function categorize(sys, dia) {
    if (sys > 180 || dia > 120) return "crisis";
    if (sys >= 140 || dia >= 90) return "stage2";
    if (sys >= 130 || dia >= 80) return "stage1";
    if (sys >= 120) return "elevated";
    return "normal";
  }
  const badge = (key) => `<span class="badge ${CATEGORIES[key].cls}">${CATEGORIES[key].label}</span>`;

  // ---------- helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const fmtTime = (d) => new Date(d).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const fmtDateTime = (d) => `${fmtDate(d)} ${fmtTime(d)}`;
  const pad = (n) => String(n).padStart(2, "0");
  const toLocalInput = (date) =>
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const toDateInput = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const noteArm = (r) => [r.note, r.arm ? `${r.arm} arm` : null].filter(Boolean).join(" · ");
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN);
  const round = (n) => (Number.isFinite(n) ? Math.round(n) : "—");
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function inRange(days) {
    if (days === "all") return readings.slice();
    const cutoff = Date.now() - Number(days) * 86400000;
    return readings.filter((r) => Date.parse(r.ts) >= cutoff);
  }
  function between(fromStr, toStr) {
    const from = fromStr ? new Date(fromStr + "T00:00:00").getTime() : -Infinity;
    const to = toStr ? new Date(toStr + "T23:59:59.999").getTime() : Infinity;
    return readings.filter((r) => {
      const t = Date.parse(r.ts);
      return t >= from && t <= to;
    });
  }

  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 3200);
  }

  // ---------- tabs ----------
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => showTab(btn.dataset.tab));
  });
  function showTab(name) {
    document.querySelectorAll(".tab").forEach((b) => {
      const on = b.dataset.tab === name;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", String(on));
    });
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("is-active", p.dataset.panel === name));
    if (name === "trends") renderTrends();
    if (name === "report") renderReportPreview();
    if (name === "history") renderHistory();
    try {
      localStorage.setItem("bp4me.tab", name);
    } catch {}
  }

  // ---------- log form ----------
  const form = $("#readingForm");
  const sysIn = $("#sys"), diaIn = $("#dia"), pulIn = $("#pul"), tsIn = $("#ts"), armIn = $("#arm"), noteIn = $("#note");
  const sourceIn = $("#source"), editIdIn = $("#editId");
  let lastIrregular = false;

  function resetForm() {
    form.reset();
    tsIn.value = toLocalInput(new Date());
    sourceIn.value = "manual";
    editIdIn.value = "";
    lastIrregular = false;
    [sysIn, diaIn, pulIn].forEach((i) => i.classList.remove("from-ai"));
    $("#preview").hidden = true;
    $("#previewImg").removeAttribute("src");
    $("#readStatus").innerHTML = "";
    $("#saveBtn").textContent = "Save reading";
    updateCategoryLine();
  }
  function updateCategoryLine() {
    const sys = Number(sysIn.value), dia = Number(diaIn.value);
    const line = $("#categoryLine");
    if (!sys || !dia) {
      line.innerHTML = "";
      return;
    }
    let html = badge(categorize(sys, dia));
    if (sys <= dia) html += `<span class="muted small">Systolic should be higher than diastolic.</span>`;
    if (lastIrregular) html += `<span class="badge badge-irregular">Irregular heartbeat flagged</span>`;
    line.innerHTML = html;
  }
  [sysIn, diaIn].forEach((i) => i.addEventListener("input", updateCategoryLine));
  [sysIn, diaIn, pulIn].forEach((i) => i.addEventListener("input", () => i.classList.remove("from-ai")));

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const sys = Number(sysIn.value), dia = Number(diaIn.value);
    const pul = pulIn.value === "" ? null : Number(pulIn.value);
    if (!(sys > dia)) {
      toast("Systolic must be greater than diastolic.");
      sysIn.focus();
      return;
    }
    const ts = new Date(tsIn.value);
    if (Number.isNaN(ts.getTime())) {
      toast("Please enter a valid date and time.");
      return;
    }
    const reading = {
      id: editIdIn.value || newId(),
      ts: ts.toISOString(),
      sys, dia, pul,
      arm: armIn.value || null,
      note: noteIn.value.trim() || null,
      source: sourceIn.value,
      irregular: lastIrregular || null,
    };
    const idx = readings.findIndex((r) => r.id === reading.id);
    if (idx >= 0) {
      readings[idx] = { ...readings[idx], ...reading };
      toast("Reading updated.");
    } else {
      readings.push(reading);
      toast(`Saved ${sys}/${dia}${pul ? ` · ${pul} bpm` : ""}.`);
    }
    persist();
    resetForm();
  });
  $("#clearBtn").addEventListener("click", resetForm);

  function editReading(id) {
    const r = readings.find((x) => x.id === id);
    if (!r) return;
    resetForm();
    sysIn.value = r.sys;
    diaIn.value = r.dia;
    pulIn.value = r.pul ?? "";
    tsIn.value = toLocalInput(new Date(r.ts));
    armIn.value = r.arm || "";
    noteIn.value = r.note || "";
    sourceIn.value = r.source || "manual";
    lastIrregular = Boolean(r.irregular);
    editIdIn.value = id;
    $("#saveBtn").textContent = "Update reading";
    updateCategoryLine();
    showTab("log");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function deleteReading(id) {
    const r = readings.find((x) => x.id === id);
    if (!r) return;
    if (!confirm(`Delete the reading ${r.sys}/${r.dia} from ${fmtDateTime(r.ts)}?`)) return;
    readings = readings.filter((x) => x.id !== id);
    persist();
    toast("Reading deleted.");
  }

  // ---------- photo → vision ----------
  $("#photoInput").addEventListener("change", (e) => handlePhoto(e.target.files[0]));
  $("#photoPick").addEventListener("change", (e) => handlePhoto(e.target.files[0]));

  async function handlePhoto(file) {
    if (!file) return;
    $("#photoInput").value = "";
    $("#photoPick").value = "";
    const status = $("#readStatus");
    $("#preview").hidden = false;
    status.innerHTML = `<span class="spinner"></span>Reading the display…`;
    try {
      const { dataUrl, base64 } = await downscale(file, 1600, 0.85);
      $("#previewImg").src = dataUrl;
      const res = await fetch("/api/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: base64, media_type: "image/jpeg" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        status.innerHTML = `<b>Could not read the photo.</b> ${escapeHtml(data.message || `Server error ${res.status}.`)}`;
        return;
      }
      const r = data.reading;
      if (!r.found || !r.sys || !r.dia) {
        status.innerHTML = `<b>No readable monitor found.</b> ${escapeHtml(r.notes || "")} Try again with the screen filling the frame, or enter the values by hand.`;
        return;
      }
      sysIn.value = r.sys;
      diaIn.value = r.dia;
      pulIn.value = r.pul || "";
      [sysIn, diaIn, pulIn].forEach((i) => i.classList.toggle("from-ai", i.value !== ""));
      sourceIn.value = "ai";
      lastIrregular = Boolean(r.irregular_heartbeat);
      if (!tsIn.value) tsIn.value = toLocalInput(new Date());
      updateCategoryLine();
      const conf = { high: "High", medium: "Medium", low: "Low" }[r.confidence] || r.confidence;
      let html = `<b>Read ${r.sys}/${r.dia}${r.pul ? ` · ${r.pul} bpm` : ""}</b> — confidence: ${escapeHtml(conf)}.`;
      if (data.warning) html += `<br><b>Check this:</b> ${escapeHtml(data.warning)}`;
      else if (r.confidence !== "high") html += `<br>Please double-check the numbers against the monitor.`;
      if (r.notes) html += `<br><span class="muted small">${escapeHtml(r.notes)}</span>`;
      status.innerHTML = html;
      sysIn.focus();
    } catch (err) {
      console.error(err);
      status.innerHTML = `<b>Could not process the photo.</b> ${escapeHtml(err.message || "")}`;
    }
  }

  async function downscale(file, maxSide, quality) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      bitmap = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Unsupported image format."));
        img.src = URL.createObjectURL(file);
      });
    }
    const w = bitmap.width, h = bitmap.height;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (bitmap.close) bitmap.close();
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    return { dataUrl, base64: dataUrl.split(",")[1] };
  }

  // ---------- recent + history ----------
  function rowActions(id) {
    return `<div class="row-actions"><button class="icon-btn" data-edit="${id}" aria-label="Edit">Edit</button><button class="icon-btn" data-delete="${id}" aria-label="Delete">Delete</button></div>`;
  }
  function renderRecent() {
    const list = $("#recentList");
    const recent = readings.slice(0, 5);
    if (!recent.length) {
      list.innerHTML = `<p class="muted">No readings yet. Photograph your monitor or type the values above.</p>`;
      return;
    }
    list.innerHTML = recent
      .map(
        (r) => `<div class="recent-item">
          <div><span class="recent-when">${fmtDateTime(r.ts)}${r.arm ? ` · ${r.arm} arm` : ""}</span>${r.note ? `<span class="recent-note">${escapeHtml(r.note)}</span>` : ""}</div>
          <div class="recent-vals">${r.sys}/${r.dia} <small>mmHg</small>${r.pul ? ` · ${r.pul} <small>bpm</small>` : ""}<br>${badge(categorize(r.sys, r.dia))}</div>
          ${rowActions(r.id)}
        </div>`,
      )
      .join("");
  }
  function renderHistory() {
    const rows = inRange($("#historyRange").value);
    const tbody = $("#historyTable tbody");
    $("#historyEmpty").hidden = rows.length > 0;
    tbody.innerHTML = rows
      .map(
        (r) => `<tr>
          <td>${fmtDate(r.ts)}</td><td>${fmtTime(r.ts)}</td>
          <td class="num"><b>${r.sys}</b></td><td class="num"><b>${r.dia}</b></td><td class="num">${r.pul ?? "—"}</td>
          <td>${badge(categorize(r.sys, r.dia))}${r.irregular ? ` <span class="badge badge-irregular">Irregular</span>` : ""}</td>
          <td class="note">${escapeHtml(noteArm(r))}</td>
          <td>${rowActions(r.id)}</td>
        </tr>`,
      )
      .join("");
  }
  document.body.addEventListener("click", (e) => {
    const edit = e.target.closest("[data-edit]");
    if (edit) return editReading(edit.dataset.edit);
    const del = e.target.closest("[data-delete]");
    if (del) return deleteReading(del.dataset.delete);
  });
  $("#historyRange").addEventListener("change", renderHistory);

  // ---------- trends ----------
  let bpChart, pulseChart;
  $("#trendRange").addEventListener("change", renderTrends);

  function stats(rows) {
    const sys = rows.map((r) => r.sys), dia = rows.map((r) => r.dia), pul = rows.filter((r) => r.pul).map((r) => r.pul);
    const below = rows.filter((r) => r.sys < 130 && r.dia < 80).length;
    return {
      n: rows.length,
      avgSys: avg(sys), avgDia: avg(dia), avgPul: avg(pul),
      minSys: Math.min(...sys), maxSys: Math.max(...sys), minDia: Math.min(...dia), maxDia: Math.max(...dia),
      pctBelow: rows.length ? Math.round((100 * below) / rows.length) : NaN,
      irregular: rows.filter((r) => r.irregular).length,
    };
  }
  function timeOfDay(rows) {
    const buckets = { Morning: [], Afternoon: [], Evening: [], Night: [] };
    rows.forEach((r) => {
      const h = new Date(r.ts).getHours();
      const k = h >= 5 && h < 12 ? "Morning" : h >= 12 && h < 18 ? "Afternoon" : h >= 18 && h < 23 ? "Evening" : "Night";
      buckets[k].push(r);
    });
    return buckets;
  }

  function renderTrends() {
    const rows = inRange($("#trendRange").value).slice().reverse(); // chronological
    const s = stats(rows);
    $("#statGrid").innerHTML = rows.length
      ? `
      <div class="stat"><div class="label">Average</div><div class="value">${round(s.avgSys)}/${round(s.avgDia)} <small>mmHg</small></div><div class="sub">${badge(categorize(round(s.avgSys), round(s.avgDia)))}</div></div>
      <div class="stat"><div class="label">Average pulse</div><div class="value">${round(s.avgPul)} <small>bpm</small></div></div>
      <div class="stat"><div class="label">Systolic range</div><div class="value">${s.minSys}–${s.maxSys}</div></div>
      <div class="stat"><div class="label">Diastolic range</div><div class="value">${s.minDia}–${s.maxDia}</div></div>
      <div class="stat"><div class="label">Below 130/80</div><div class="value">${s.pctBelow}<small>%</small></div><div class="sub">${s.n} reading${s.n === 1 ? "" : "s"}${s.irregular ? ` · ${s.irregular} irregular` : ""}</div></div>`
      : `<p class="muted">No readings in this period.</p>`;

    const tod = timeOfDay(rows);
    $("#todTable tbody").innerHTML = Object.entries(tod)
      .map(([k, v]) => {
        const st = stats(v);
        return `<tr><td>${k}</td><td class="num">${v.length}</td><td class="num">${round(st.avgSys)}</td><td class="num">${round(st.avgDia)}</td><td class="num">${round(st.avgPul)}</td></tr>`;
      })
      .join("");

    const cSys = cssVar("--series-sys"), cDia = cssVar("--series-dia"), cPul = cssVar("--series-pul");
    $("#bpLegend").innerHTML = `<span style="--c:${cSys}">Systolic</span><span style="--c:${cDia}">Diastolic</span>`;
    bpChart = drawChart(bpChart, $("#bpChart"), rows, [
      { label: "Systolic", key: "sys", color: cSys },
      { label: "Diastolic", key: "dia", color: cDia },
    ], { min: 60, max: 160, thresholds: [130, 80], unit: "mmHg" });
    pulseChart = drawChart(pulseChart, $("#pulseChart"), rows.filter((r) => r.pul), [
      { label: "Pulse", key: "pul", color: cPul },
    ], { min: 50, max: 100, thresholds: [], unit: "bpm" });
  }

  function drawChart(existing, canvas, rows, series, opts) {
    if (existing) existing.destroy();
    if (typeof Chart === "undefined") return null;
    const grid = cssVar("--border"), ink = cssVar("--text-2");
    const xs = rows.map((r) => Date.parse(r.ts));
    const xMin = xs.length ? Math.min(...xs) : Date.now() - 7 * 86400000;
    const xMax = xs.length ? Math.max(...xs) : Date.now();
    const span = Math.max(xMax - xMin, 86400000);
    const datasets = series.map((s) => ({
      label: s.label,
      data: rows.map((r) => ({ x: Date.parse(r.ts), y: r[s.key], r })),
      borderColor: s.color,
      backgroundColor: s.color,
      borderWidth: 2,
      pointRadius: rows.length > 60 ? 2 : 4,
      pointHoverRadius: 6,
      pointBorderColor: cssVar("--surface-2"),
      pointBorderWidth: 1.5,
      tension: 0.25,
    }));
    opts.thresholds.forEach((t) => {
      datasets.push({
        label: `${t} ${opts.unit}`,
        data: [{ x: xMin - span * 0.05, y: t }, { x: xMax + span * 0.05, y: t }],
        borderColor: ink, borderDash: [4, 4], borderWidth: 1, pointRadius: 0, pointHoverRadius: 0,
        _threshold: true,
      });
    });
    const yValues = rows.flatMap((r) => series.map((s) => r[s.key])).filter(Number.isFinite);
    const yMin = Math.min(opts.min, ...yValues.map((v) => v - 5)), yMax = Math.max(opts.max, ...yValues.map((v) => v + 5));
    return new Chart(canvas, {
      type: "line",
      data: { datasets },
      options: {
        parsing: false,
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "nearest", axis: "x", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            filter: (item) => !item.dataset._threshold,
            callbacks: {
              title: (items) => (items.length ? fmtDateTime(items[0].raw.x) : ""),
              label: (item) => ` ${item.dataset.label}: ${item.raw.y} ${opts.unit}`,
              afterBody: (items) => {
                const r = items[0]?.raw?.r;
                if (!r) return [];
                const lines = [];
                if (series.length > 1) lines.push(CATEGORIES[categorize(r.sys, r.dia)].label);
                if (r.note) lines.push(r.note);
                return lines;
              },
            },
          },
        },
        scales: {
          x: {
            type: "linear",
            min: xMin - span * 0.03, max: xMax + span * 0.03,
            grid: { color: grid, drawTicks: false },
            border: { color: grid },
            ticks: { color: ink, maxTicksLimit: 8, maxRotation: 0, callback: (v) => new Date(v).toLocaleDateString(undefined, span > 400 * 86400000 ? { month: "short", year: "2-digit" } : { month: "short", day: "numeric" }) },
          },
          y: {
            min: Math.floor(yMin / 10) * 10, max: Math.ceil(yMax / 10) * 10,
            grid: { color: grid, drawTicks: false },
            border: { display: false },
            ticks: { color: ink, stepSize: 20 },
          },
        },
      },
    });
  }

  // ---------- report ----------
  const reportFrom = $("#reportFrom"), reportTo = $("#reportTo");
  (() => {
    const to = new Date(), from = new Date(Date.now() - 30 * 86400000);
    reportFrom.value = toDateInput(from);
    reportTo.value = toDateInput(to);
  })();
  [reportFrom, reportTo, $("#reportNote")].forEach((el) => el.addEventListener("change", renderReportPreview));

  function reportData() {
    const rows = between(reportFrom.value, reportTo.value).slice().reverse();
    return { rows, s: stats(rows), from: reportFrom.value, to: reportTo.value, note: $("#reportNote").value.trim() };
  }
  function reportTitleParts() {
    const name = settings.name ? `${settings.name}` : "Blood pressure readings";
    const period = `${fmtDate(reportFrom.value + "T12:00:00")} – ${fmtDate(reportTo.value + "T12:00:00")}`;
    return { name, period };
  }

  function renderReportPreview() {
    const { rows, s, note } = reportData();
    const { name, period } = reportTitleParts();
    const tod = timeOfDay(rows);
    const todRows = Object.entries(tod).filter(([, v]) => v.length);
    $("#reportBody").innerHTML = `<div class="report">
      <h2>${escapeHtml(name)} — blood pressure report</h2>
      <div class="report-meta">${period}${settings.dob ? ` · Born ${fmtDate(settings.dob + "T12:00:00")}` : ""}${settings.doctorName ? ` · For ${escapeHtml(settings.doctorName)}` : ""} · Generated ${fmtDate(new Date())}</div>
      ${note ? `<p><b>Note:</b> ${escapeHtml(note)}</p>` : ""}
      ${rows.length ? `
      <div class="report-stats">
        <div>Average<b>${round(s.avgSys)}/${round(s.avgDia)} mmHg</b>${CATEGORIES[categorize(round(s.avgSys), round(s.avgDia))].label}</div>
        <div>Average pulse<b>${round(s.avgPul)} bpm</b></div>
        <div>Systolic range<b>${s.minSys}–${s.maxSys}</b></div>
        <div>Diastolic range<b>${s.minDia}–${s.maxDia}</b></div>
        <div>Readings<b>${s.n}</b>${s.pctBelow}% below 130/80${s.irregular ? `, ${s.irregular} irregular` : ""}</div>
      </div>
      ${todRows.length > 1 ? `<table><thead><tr><th>Time of day</th><th class="num">Readings</th><th class="num">Avg SYS</th><th class="num">Avg DIA</th><th class="num">Avg PUL</th></tr></thead><tbody>${todRows
        .map(([k, v]) => { const st = stats(v); return `<tr><td>${k}</td><td class="num">${v.length}</td><td class="num">${round(st.avgSys)}</td><td class="num">${round(st.avgDia)}</td><td class="num">${round(st.avgPul)}</td></tr>`; })
        .join("")}</tbody></table>` : ""}
      <div class="report-chart" id="reportChartHolder"></div>
      <table><thead><tr><th>Date</th><th>Time</th><th class="num">SYS</th><th class="num">DIA</th><th class="num">PUL</th><th>Category</th><th>Note</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${fmtDate(r.ts)}</td><td>${fmtTime(r.ts)}</td><td class="num">${r.sys}</td><td class="num">${r.dia}</td><td class="num">${r.pul ?? ""}</td><td>${CATEGORIES[categorize(r.sys, r.dia)].label}${r.irregular ? " · irregular" : ""}</td><td>${escapeHtml(noteArm(r))}</td></tr>`).join("")}</tbody></table>`
      : `<p class="muted">No readings in this period.</p>`}
      <p class="disclaimer">Generated with BP4me from a home blood pressure monitor. Categories per 2017 ACC/AHA guideline. Not a medical device.</p>
    </div>`;
    if (rows.length) {
      const img = document.createElement("img");
      img.alt = "Blood pressure chart";
      img.src = reportChartImage(rows);
      $("#reportChartHolder").appendChild(img);
    }
  }

  // Renders an offscreen, light-themed chart and returns a PNG data URL (used in preview and PDF).
  function reportChartImage(rows) {
    if (typeof Chart === "undefined") return "";
    const canvas = document.createElement("canvas");
    canvas.width = 1400; canvas.height = 500;
    const xs = rows.map((r) => Date.parse(r.ts));
    const xMin = Math.min(...xs), xMax = Math.max(...xs), span = Math.max(xMax - xMin, 86400000);
    const mk = (label, key, color) => ({
      label, data: rows.map((r) => ({ x: Date.parse(r.ts), y: r[key] })), borderColor: color, backgroundColor: color,
      borderWidth: 3, pointRadius: rows.length > 60 ? 3 : 5, pointBorderColor: "#fff", pointBorderWidth: 1.5, tension: 0.25,
    });
    const thr = (t) => ({ label: `${t}`, data: [{ x: xMin - span * 0.05, y: t }, { x: xMax + span * 0.05, y: t }], borderColor: "#8a8983", borderDash: [4, 4], borderWidth: 1, pointRadius: 0 });
    const chart = new Chart(canvas, {
      type: "line",
      data: { datasets: [mk("Systolic", "sys", "#2a78d6"), mk("Diastolic", "dia", "#eb6834"), ...(rows.some((r) => r.pul) ? [mk("Pulse", "pul", "#1baf7a")] : []), thr(130), thr(80)] },
      options: {
        parsing: false, animation: false, responsive: false, devicePixelRatio: 1,
        plugins: { legend: { display: true, position: "top", labels: { color: "#0b0b0b", font: { size: 22 }, filter: (i) => ["Systolic", "Diastolic", "Pulse"].includes(i.text), boxWidth: 28, boxHeight: 5 } }, tooltip: { enabled: false } },
        scales: {
          x: { type: "linear", min: xMin - span * 0.03, max: xMax + span * 0.03, grid: { color: "#e2e1dc" }, ticks: { color: "#52514e", font: { size: 20 }, maxTicksLimit: 10, callback: (v) => new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric" }) } },
          y: { min: 40, max: Math.max(180, ...rows.map((r) => r.sys)) + 10, grid: { color: "#e2e1dc" }, ticks: { color: "#52514e", font: { size: 20 }, stepSize: 20 } },
        },
      },
      plugins: [{ id: "bg", beforeDraw: (c) => { const ctx = c.ctx; ctx.save(); ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height); ctx.restore(); } }],
    });
    const url = canvas.toDataURL("image/png");
    chart.destroy();
    return url;
  }

  function buildPdf() {
    if (!window.jspdf) {
      toast("PDF library did not load. Check your connection.");
      return null;
    }
    const { rows, s, note } = reportData();
    if (!rows.length) {
      toast("No readings in the selected period.");
      return null;
    }
    const { name, period } = reportTitleParts();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const W = doc.internal.pageSize.getWidth(), M = 14;
    let y = 18;
    doc.setFont("helvetica", "bold").setFontSize(18).text(`${name} — blood pressure report`, M, y);
    y += 7;
    doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(82, 81, 78);
    const meta = [period, settings.dob ? `Born ${fmtDate(settings.dob + "T12:00:00")}` : null, settings.doctorName ? `For ${settings.doctorName}` : null, `Generated ${fmtDate(new Date())}`].filter(Boolean).join("  ·  ");
    doc.text(meta, M, y);
    y += 6;
    doc.setTextColor(11, 11, 11);
    if (note) {
      const lines = doc.splitTextToSize(`Note: ${note}`, W - 2 * M);
      doc.text(lines, M, y);
      y += lines.length * 5 + 1;
    }
    // summary tiles
    const tiles = [
      ["Average", `${round(s.avgSys)}/${round(s.avgDia)} mmHg`, CATEGORIES[categorize(round(s.avgSys), round(s.avgDia))].label],
      ["Average pulse", `${round(s.avgPul)} bpm`, ""],
      ["Systolic range", `${s.minSys}–${s.maxSys}`, ""],
      ["Diastolic range", `${s.minDia}–${s.maxDia}`, ""],
      ["Readings", `${s.n}`, `${s.pctBelow}% below 130/80${s.irregular ? `, ${s.irregular} irregular` : ""}`],
    ];
    const tw = (W - 2 * M - 4 * 3) / 5;
    tiles.forEach(([label, value, sub], i) => {
      const x = M + i * (tw + 3);
      doc.setDrawColor(226, 225, 220).roundedRect(x, y, tw, 18, 2, 2);
      doc.setFontSize(7).setTextColor(138, 137, 131).text(label.toUpperCase(), x + 2.5, y + 4.5);
      doc.setFontSize(12).setTextColor(11, 11, 11).setFont("helvetica", "bold").text(value, x + 2.5, y + 10.5);
      doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(82, 81, 78).text(doc.splitTextToSize(sub, tw - 5)[0] || "", x + 2.5, y + 15);
    });
    y += 24;
    // chart
    const img = reportChartImage(rows);
    if (img) {
      const iw = W - 2 * M, ih = iw * (500 / 1400);
      doc.addImage(img, "PNG", M, y, iw, ih);
      y += ih + 5;
    }
    // time of day
    const todRows = Object.entries(timeOfDay(rows)).filter(([, v]) => v.length);
    if (todRows.length > 1) {
      doc.autoTable({
        startY: y, margin: { left: M, right: M }, theme: "plain", styles: { fontSize: 8, cellPadding: 1.5 },
        headStyles: { fontStyle: "bold", textColor: [82, 81, 78] },
        head: [["Time of day", "Readings", "Avg SYS", "Avg DIA", "Avg PUL"]],
        body: todRows.map(([k, v]) => { const st = stats(v); return [k, v.length, round(st.avgSys), round(st.avgDia), round(st.avgPul)]; }),
        columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
      });
      y = doc.lastAutoTable.finalY + 5;
    }
    // readings table
    doc.autoTable({
      startY: y, margin: { left: M, right: M, bottom: 18 }, theme: "striped",
      styles: { fontSize: 8, cellPadding: 1.6 }, headStyles: { fillColor: [42, 120, 214] },
      head: [["Date", "Time", "SYS", "DIA", "PUL", "Category", "Note"]],
      body: rows.map((r) => [fmtDate(r.ts), fmtTime(r.ts), r.sys, r.dia, r.pul ?? "", CATEGORIES[categorize(r.sys, r.dia)].label + (r.irregular ? " · irregular" : ""), noteArm(r)]),
      columnStyles: { 2: { halign: "right", fontStyle: "bold" }, 3: { halign: "right", fontStyle: "bold" }, 4: { halign: "right" }, 6: { cellWidth: 55 } },
      didDrawPage: () => {
        const h = doc.internal.pageSize.getHeight();
        doc.setFontSize(7).setTextColor(138, 137, 131).text(
          "Generated with BP4me from a home blood pressure monitor. Categories per 2017 ACC/AHA guideline. Not a medical device.", M, h - 8);
        doc.text(`Page ${doc.internal.getNumberOfPages()}`, W - M, h - 8, { align: "right" });
      },
    });
    return doc;
  }
  const pdfFilename = () => `BP4me-report-${reportFrom.value}_to_${reportTo.value}.pdf`;

  $("#pdfBtn").addEventListener("click", () => {
    const doc = buildPdf();
    if (doc) {
      doc.save(pdfFilename());
      toast("PDF downloaded.");
    }
  });
  $("#printBtn").addEventListener("click", () => {
    renderReportPreview();
    window.print();
  });
  $("#emailBtn").addEventListener("click", () => {
    const { rows, s } = reportData();
    const { name, period } = reportTitleParts();
    if (!rows.length) return toast("No readings in the selected period.");
    const subject = `Blood pressure readings — ${name} — ${period}`;
    const body = [
      settings.doctorName ? `Dear ${settings.doctorName},` : "Hello,",
      "",
      `Please find attached my blood pressure readings for ${period} (${s.n} readings).`,
      `Average: ${round(s.avgSys)}/${round(s.avgDia)} mmHg, pulse ${round(s.avgPul)} bpm.`,
      `Systolic ${s.minSys}–${s.maxSys}, diastolic ${s.minDia}–${s.maxDia}. ${s.pctBelow}% of readings below 130/80.`,
      $("#reportNote").value.trim() ? `\n${$("#reportNote").value.trim()}` : "",
      "",
      `The PDF report (${pdfFilename()}) is attached.`,
      "",
      settings.name || "",
    ].join("\n");
    const doc = buildPdf();
    if (doc) doc.save(pdfFilename());
    const url = `mailto:${encodeURIComponent(settings.doctorEmail || "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = url;
    toast("PDF downloaded — attach it to the email.");
  });

  // ---------- settings ----------
  function loadSettingsForm() {
    $("#setName").value = settings.name || "";
    $("#setDob").value = settings.dob || "";
    $("#setDoctorEmail").value = settings.doctorEmail || "";
    $("#setDoctorName").value = settings.doctorName || "";
  }
  $("#saveSettingsBtn").addEventListener("click", () => {
    settings = {
      name: $("#setName").value.trim(),
      dob: $("#setDob").value,
      doctorEmail: $("#setDoctorEmail").value.trim(),
      doctorName: $("#setDoctorName").value.trim(),
    };
    saveJSON(SETTINGS_KEY, settings);
    $("#settingsStatus").textContent = "Saved.";
    setTimeout(() => ($("#settingsStatus").textContent = ""), 2000);
  });

  function download(filename, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const stamp = () => toDateInput(new Date());
  $("#exportJsonBtn").addEventListener("click", () => {
    download(`bp4me-${stamp()}.json`, JSON.stringify({ app: "BP4me", version: 1, exported: new Date().toISOString(), settings, readings }, null, 2), "application/json");
  });
  $("#exportCsvBtn").addEventListener("click", () => {
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = ["timestamp,date,time,sys,dia,pul,category,arm,irregular,note,source"];
    readings.slice().reverse().forEach((r) => {
      lines.push([r.ts, fmtDate(r.ts), fmtTime(r.ts), r.sys, r.dia, r.pul ?? "", CATEGORIES[categorize(r.sys, r.dia)].label, r.arm ?? "", r.irregular ? "yes" : "", r.note ?? "", r.source ?? ""].map(q).join(","));
    });
    download(`bp4me-${stamp()}.csv`, lines.join("\n"), "text/csv");
  });
  $("#importInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const incoming = (Array.isArray(data) ? data : data.readings || []).filter(isValidReading);
      if (!incoming.length) throw new Error("No readings found in that file.");
      const existing = new Set(readings.map((r) => r.id));
      const keys = new Set(readings.map((r) => `${r.ts}|${r.sys}|${r.dia}`));
      let added = 0;
      incoming.forEach((r) => {
        const key = `${r.ts}|${r.sys}|${r.dia}`;
        if (existing.has(r.id) || keys.has(key)) return;
        readings.push({ ...r, id: r.id || newId() });
        keys.add(key);
        added++;
      });
      if (data.settings && !settings.name) {
        settings = { ...settings, ...data.settings };
        saveJSON(SETTINGS_KEY, settings);
        loadSettingsForm();
      }
      persist();
      $("#dataStatus").textContent = `Imported ${added} new reading${added === 1 ? "" : "s"} (${incoming.length - added} duplicates skipped).`;
    } catch (err) {
      $("#dataStatus").textContent = `Import failed: ${err.message}`;
    }
  });
  $("#wipeBtn").addEventListener("click", () => {
    if (!readings.length) return toast("Nothing to delete.");
    if (!confirm(`Delete all ${readings.length} readings from this browser? Export first if you want a backup.`)) return;
    readings = [];
    persist();
    $("#dataStatus").textContent = "All readings deleted.";
  });

  fetch("/api/health")
    .then((r) => r.json())
    .then((h) => {
      $("#visionStatus").textContent = h.vision ? `ready (${h.model})` : "not configured — manual entry only";
    })
    .catch(() => ($("#visionStatus").textContent = "unavailable"));

  // ---------- init ----------
  function renderAll() {
    renderRecent();
    const active = document.querySelector(".panel.is-active")?.dataset.panel;
    if (active === "history") renderHistory();
    if (active === "trends") renderTrends();
    if (active === "report") renderReportPreview();
  }
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (document.querySelector(".panel.is-active")?.dataset.panel === "trends") renderTrends();
  });

  loadSettingsForm();
  resetForm();
  renderRecent();
  let startTab = "log";
  try {
    startTab = localStorage.getItem("bp4me.tab") || "log";
  } catch {}
  if (startTab !== "log") showTab(startTab);
})();
