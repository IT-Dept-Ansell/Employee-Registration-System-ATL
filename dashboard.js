(function () {
  const el = id => document.getElementById(id);
  const toastEl = el('toast');
  const lastUpdated = el('lastUpdated');

  const statEls = {
    total: el('statTotal'),
    Registered: el('statRegistered'),
    Male: el('statMale'),
    Female: el('statFemale'),
    Duplicate: el('statDuplicate'),
    Mismatch: el('statMismatch'),
  };

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function fmtTime(iso) {
    try { return new Date(iso).toLocaleString(); } catch (e) { return iso; }
  }
  function statusClass(result) {
    return { Registered:'registered', Duplicate:'duplicate', Mismatch:'mismatch', Inactive:'inactive' }[result] || '';
  }

  /* ---------------- chart setup ---------------- */
  const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const COLORS = {
    teal: cssVar('--teal'), amber: cssVar('--amber'), coral: cssVar('--coral'),
    slate: cssVar('--slate'), male: cssVar('--male'), female: cssVar('--female'),
    ink: cssVar('--ink-dim'), line: cssVar('--line')
  };
  Chart.defaults.color = COLORS.ink;
  Chart.defaults.font.family = "'Inter', sans-serif";
  Chart.defaults.borderColor = COLORS.line;

  const chartResults = new Chart(el('chartResults'), {
    type: 'bar',
    data: {
      labels: ['Registered', 'Duplicate', 'Mismatch', 'Inactive'],
      datasets: [{
        data: [0,0,0,0],
        backgroundColor: [COLORS.teal, COLORS.amber, COLORS.coral, COLORS.slate],
        borderRadius: 8, maxBarThickness: 56
      }]
    },
    options: { plugins:{legend:{display:false}}, scales:{ y:{ beginAtZero:true, ticks:{precision:0} } } }
  });

  const chartGender = new Chart(el('chartGender'), {
    type: 'doughnut',
    data: {
      labels: ['Male', 'Female'],
      datasets: [{ data: [0,0], backgroundColor: [COLORS.male, COLORS.female], borderWidth:0 }]
    },
    options: { plugins:{legend:{position:'bottom'}}, cutout:'65%' }
  });

  const chartStation = new Chart(el('chartStation'), {
    type: 'bar',
    data: { labels: [], datasets: [{ data: [], backgroundColor: COLORS.teal, borderRadius:8, maxBarThickness:36 }] },
    options: { plugins:{legend:{display:false}}, scales:{ y:{ beginAtZero:true, ticks:{precision:0} } } }
  });

  const chartHour = new Chart(el('chartHour'), {
    type: 'line',
    data: { labels: [], datasets: [{ data: [], borderColor: COLORS.teal, backgroundColor:'rgba(18,214,176,0.15)', fill:true, tension:0.3, pointRadius:3 }] },
    options: { plugins:{legend:{display:false}}, scales:{ y:{ beginAtZero:true, ticks:{precision:0} } } }
  });

  /* ---------------- data refresh ---------------- */
  async function refresh() {
    if (!APP_URL || APP_URL.indexOf('PASTE_YOUR') !== -1) {
      lastUpdated.textContent = 'Set APP_URL in config.js';
      return;
    }
    try {
      const res = await fetch(APP_URL + '?action=summary');
      const data = await res.json();
      if (data.error) { lastUpdated.textContent = data.error; return; }

      statEls.total.textContent = data.total || 0;
      statEls.Registered.textContent = data.counts.Registered || 0;
      statEls.Male.textContent = data.counts.Male || 0;
      statEls.Female.textContent = data.counts.Female || 0;
      statEls.Duplicate.textContent = data.counts.Duplicate || 0;
      statEls.Mismatch.textContent = data.counts.Mismatch || 0;

      chartResults.data.datasets[0].data = [
        data.counts.Registered||0, data.counts.Duplicate||0, data.counts.Mismatch||0, data.counts.Inactive||0
      ];
      chartResults.update();

      chartGender.data.datasets[0].data = [data.counts.Male||0, data.counts.Female||0];
      chartGender.update();

      const stationKeys = Object.keys(data.byStation || {}).sort((a,b) => a.localeCompare(b, undefined, {numeric:true}));
      chartStation.data.labels = stationKeys.map(s => 'Station ' + s);
      chartStation.data.datasets[0].data = stationKeys.map(s => data.byStation[s]);
      chartStation.update();

      const hourKeys = Object.keys(data.byHour || {}).sort();
      chartHour.data.labels = hourKeys;
      chartHour.data.datasets[0].data = hourKeys.map(h => data.byHour[h]);
      chartHour.update();

      el('masterCount').textContent = (data.masterCount || 0) + ' employees loaded';
      renderTable(data.recent || []);
      lastUpdated.textContent = 'Updated ' + new Date().toLocaleTimeString();
    } catch (e) {
      lastUpdated.textContent = 'Connection error — retrying…';
    }
  }

  function renderTable(rows) {
    const body = el('logBody');
    const empty = el('emptyState');
    el('tableMeta').textContent = rows.length + ' record' + (rows.length===1?'':'s') + (rows.length>=500?' (most recent 500 shown — use export for full log)':'');
    if (!rows.length) { body.innerHTML=''; empty.style.display='block'; return; }
    empty.style.display = 'none';
    body.innerHTML = rows.map(r => {
      const cls = statusClass(r.result);
      return '<tr class="row-'+cls+'">' +
        '<td>'+fmtTime(r.timestamp)+'</td>' +
        '<td>'+escapeHtml(r.empNo)+'</td>' +
        '<td>'+escapeHtml(r.name||'—')+'</td>' +
        '<td>'+escapeHtml(r.gender||'—')+'</td>' +
        '<td>'+escapeHtml(String(r.station||'—'))+'</td>' +
        '<td><span class="badge '+cls+'">'+r.result+'</span></td>' +
      '</tr>';
    }).join('');
  }

  /* ---------------- CSV helpers ---------------- */
  function parseCsv(text) {
    // Small parser: handles quoted fields with commas, strips a header row if present.
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"' && text[i+1] === '"') { field += '"'; i++; }
        else if (c === '"') { inQuotes = false; }
        else { field += c; }
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ',') { row.push(field); field=''; }
        else if (c === '\n' || c === '\r') {
          if (field.length || row.length) { row.push(field); rows.push(row); }
          field=''; row=[];
          if (c === '\r' && text[i+1] === '\n') i++;
        } else field += c;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(v => v.trim() !== ''));
  }

  function looksLikeHeader(row) {
    const first = (row[0] || '').toLowerCase();
    return first.indexOf('emp') !== -1 && isNaN(Number(row[0]));
  }

  el('uploadBtn').addEventListener('click', async () => {
    const file = el('csvFile').files[0];
    if (!file) { showToast('Choose a CSV file first'); return; }
    if (!APP_URL || APP_URL.indexOf('PASTE_YOUR') !== -1) { showToast('Set APP_URL in config.js first'); return; }

    const text = await file.text();
    let rows = parseCsv(text);
    if (rows.length && looksLikeHeader(rows[0])) rows = rows.slice(1);
    if (!rows.length) { showToast('No data rows found in that file'); return; }

    el('uploadBtn').disabled = true;
    el('uploadBtn').textContent = 'Uploading…';
    try {
      const res = await fetch(APP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ type: 'uploadMaster', rows: rows })
      });
      const data = await res.json();
      if (data.error) showToast('Error: ' + data.error);
      else { showToast(data.uploaded + ' employees loaded into master database'); refresh(); }
    } catch (e) {
      showToast('Upload failed — check your connection');
    } finally {
      el('uploadBtn').disabled = false;
      el('uploadBtn').textContent = 'Upload master CSV';
    }
  });

  el('exportBtn').addEventListener('click', async () => {
    if (!APP_URL || APP_URL.indexOf('PASTE_YOUR') !== -1) { showToast('Set APP_URL in config.js first'); return; }
    el('exportBtn').disabled = true;
    el('exportBtn').textContent = 'Preparing…';
    try {
      const res = await fetch(APP_URL + '?action=exportLog');
      const data = await res.json();
      const rows = data.rows || [];
      const header = ['TIMESTAMP','EMP_NO','EMP_NAME','GENDER','STATION','RESULT'];
      const csvLines = [header.join(',')].concat(rows.map(r => [
        r.timestamp, r.empNo, r.name, r.gender, r.station, r.result
      ].map(v => '"' + String(v==null?'':v).replace(/"/g,'""') + '"').join(',')));
      const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'employee-scan-log-' + new Date().toISOString().slice(0,10) + '.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      showToast('Export failed — check your connection');
    } finally {
      el('exportBtn').disabled = false;
      el('exportBtn').textContent = 'Export scan log (CSV)';
    }
  });

  /* ---- CLEAR LOG WITH PASSWORD ---- */
  const ADMIN_PASSWORD = 'admin 123';
  const adminModal = el('adminModal');
  const adminPassword = el('adminPassword');
  const adminConfirm = el('adminConfirm');
  const adminCancel = el('adminCancel');
  const clearLogBtn = el('clearLogBtn');

  clearLogBtn.addEventListener('click', () => {
    adminModal.style.display = 'block';
    adminPassword.value = '';
    adminPassword.focus();
  });

  adminCancel.addEventListener('click', () => {
    adminModal.style.display = 'none';
    adminPassword.value = '';
  });

  adminPassword.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      adminConfirm.click();
    }
  });

  adminConfirm.addEventListener('click', async () => {
    const enteredPassword = adminPassword.value;
    if (enteredPassword !== ADMIN_PASSWORD) {
      showToast('❌ Incorrect password');
      adminPassword.value = '';
      adminPassword.focus();
      return;
    }

    if (!APP_URL || APP_URL.indexOf('PASTE_YOUR') !== -1) {
      showToast('Set APP_URL in config.js first');
      return;
    }

    adminConfirm.disabled = true;
    adminConfirm.textContent = 'Clearing…';

    try {
      const res = await fetch(APP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ type: 'clearLog', confirm: 'YES' })
      });
      const data = await res.json();
      if (data.error) {
        showToast('❌ Error: ' + data.error);
      } else {
        showToast('✓ All scan records cleared successfully');
        adminModal.style.display = 'none';
        adminPassword.value = '';
        refresh();
      }
    } catch (e) {
      showToast('❌ Failed to clear log — check your connection');
    } finally {
      adminConfirm.disabled = false;
      adminConfirm.textContent = 'Clear All Records';
    }
  });

  // Close modal when clicking outside
  window.addEventListener('click', (e) => {
    if (e.target === adminModal) {
      adminModal.style.display = 'none';
      adminPassword.value = '';
    }
  });

  refresh();
  setInterval(refresh, (typeof POLL_MS === 'number' ? POLL_MS * 2.5 : 10000));
})();
