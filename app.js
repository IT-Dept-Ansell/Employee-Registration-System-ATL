(function () {
  const scanInput   = document.getElementById('scanInput');
  const manualBtn   = document.getElementById('manualBtn');
  const feedback    = document.getElementById('feedback');
  const logBody     = document.getElementById('logBody');
  const emptyState  = document.getElementById('emptyState');
  const tableMeta   = document.getElementById('tableMeta');
  const stationLabel= document.getElementById('stationLabel');
  const changeBtn   = document.getElementById('changeStationBtn');
  const toastEl     = document.getElementById('toast');

  const statEls = {
    total: document.getElementById('statTotal'),
    Registered: document.getElementById('statRegistered'),
    Male: document.getElementById('statMale'),
    Female: document.getElementById('statFemale'),
    Duplicate: document.getElementById('statDuplicate'),
    Mismatch: document.getElementById('statMismatch'),
  };

  let station = localStorage.getItem('ers_station');
  let lastRows = [];
  let busy = false;

  function ensureStation() {
    if (!station) {
      let s = '';
      while (!s) {
        s = prompt('Which station is this laptop? (e.g. 1–12)', '1');
        if (s === null) s = '1';
        s = s.trim();
      }
      station = s;
      localStorage.setItem('ers_station', station);
    }
    stationLabel.textContent = station;
  }
  changeBtn.addEventListener('click', () => {
    const s = prompt('Set station number for this laptop:', station || '1');
    if (s && s.trim()) {
      station = s.trim();
      localStorage.setItem('ers_station', station);
      stationLabel.textContent = station;
      showToast('Station set to ' + station);
    }
  });

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  function statusClass(result) {
    return {
      Registered: 'registered',
      Duplicate: 'duplicate',
      Mismatch: 'mismatch',
      Inactive: 'inactive'
    }[result] || '';
  }

  function fmtTime(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) { return iso; }
  }

  function renderFeedback(res) {
    const cls = statusClass(res.result);
    feedback.className = 'feedback ' + cls;
    let main, sub;
    if (res.result === 'Registered') {
      main = '✓ Registered — ' + (res.name || res.empNo);
      sub = (res.gender || '') + ' · Station ' + res.station;
    } else if (res.result === 'Duplicate') {
      main = '⚠ Duplicate — ' + (res.name || res.empNo) + ' already registered';
      sub = 'This ID was already scanned earlier';
    } else if (res.result === 'Mismatch') {
      main = '✕ Mismatch — ID ' + res.empNo + ' not found in master database';
      sub = 'Check the card number or update the master list';
    } else if (res.result === 'Inactive') {
      main = '⏸ Inactive employee — ' + (res.name || res.empNo);
      sub = 'Marked inactive in the master database';
    } else {
      main = res.error || 'Could not process scan';
      sub = '';
    }
    feedback.innerHTML = '<span class="fb-main">' + main + '</span><span class="fb-sub">' + sub + '</span>';
  }

  function renderTable(rows) {
    lastRows = rows;
    if (!rows.length) {
      logBody.innerHTML = '';
      emptyState.style.display = 'block';
      tableMeta.textContent = '0 records';
      return;
    }
    emptyState.style.display = 'none';
    tableMeta.textContent = rows.length + ' record' + (rows.length === 1 ? '' : 's');
    logBody.innerHTML = rows.map(r => {
      const cls = statusClass(r.result);
      return '<tr class="row-' + cls + '">' +
        '<td>' + fmtTime(r.timestamp) + '</td>' +
        '<td>' + escapeHtml(r.empNo) + '</td>' +
        '<td>' + escapeHtml(r.name || '—') + '</td>' +
        '<td>' + escapeHtml(r.gender || '—') + '</td>' +
        '<td>' + escapeHtml(String(r.station || '—')) + '</td>' +
        '<td><span class="badge ' + cls + '">' + r.result + '</span></td>' +
      '</tr>';
    }).join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function renderStats(summary) {
    statEls.total.textContent = summary.total || 0;
    statEls.Registered.textContent = summary.counts.Registered || 0;
    statEls.Male.textContent = summary.counts.Male || 0;
    statEls.Female.textContent = summary.counts.Female || 0;
    statEls.Duplicate.textContent = summary.counts.Duplicate || 0;
    statEls.Mismatch.textContent = summary.counts.Mismatch || 0;
  }

  async function fetchSummary() {
    if (!APP_URL || APP_URL.indexOf('PASTE_YOUR') !== -1) return;
    try {
      const res = await fetch(APP_URL + '?action=summary');
      const data = await res.json();
      if (data.error) return;
      renderStats(data);
      renderTable(data.recent);
    } catch (e) {
      // network hiccup — silently retry on next poll
    }
  }

  async function submitScan(rawValue) {
    const empNo = (rawValue || '').trim();
    if (!empNo || busy) return;
    if (!APP_URL || APP_URL.indexOf('PASTE_YOUR') !== -1) {
      renderFeedback({ result: 'Error', error: 'Set APP_URL in config.js first.' });
      return;
    }
    busy = true;
    scanInput.value = '';
    try {
      const res = await fetch(APP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight on Apps Script
        body: JSON.stringify({ type: 'scan', empNo: empNo, station: station })
      });
      const data = await res.json();
      renderFeedback(data);
      fetchSummary();
    } catch (e) {
      renderFeedback({ result: 'Error', error: 'Could not reach the server. Check your connection.' });
    } finally {
      busy = false;
      scanInput.focus();
    }
  }

  scanInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitScan(scanInput.value);
    }
  });
  manualBtn.addEventListener('click', () => submitScan(scanInput.value));

  // Keep the cursor parked in the scan field so the barcode reader always
  // has a live target, without stealing focus while typing elsewhere (e.g.
  // the station-change prompt, or selecting table text).
  document.addEventListener('click', (e) => {
    if (e.target === changeBtn || e.target === manualBtn) return;
    scanInput.focus();
  });

  ensureStation();
  fetchSummary();
  setInterval(fetchSummary, (typeof POLL_MS === 'number' ? POLL_MS : 4000));
  scanInput.focus();
})();
