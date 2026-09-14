/**
 * ANSELL EMPLOYEE REGISTRATION SYSTEM — BACKEND
 * ------------------------------------------------
 * This script turns a Google Sheet into a shared, clash-safe database
 * that all 12 scanning stations write to through one Web App URL.
 *
 * WHY THIS DESIGN:
 * GitHub Pages (or any static host) can only serve files — it cannot
 * store data or arbitrate between 12 laptops writing at once. This
 * script is the missing piece: every scan request is processed inside
 * a LockService lock, so if two stations scan at the exact same
 * instant, Apps Script queues the second request until the first has
 * finished checking + writing. That queueing is what guarantees:
 *   - no two stations can both "win" and register the same ID twice
 *   - no record is ever silently dropped
 *
 * SHEET LAYOUT (created automatically on first run if missing):
 *   Tab "Master"       -> EMP_NO | EMP_NAME | GENDER | STATUS
 *   Tab "Log"          -> TIMESTAMP | EMP_NO | EMP_NAME | GENDER | STATION | RESULT
 *
 * DEPLOY AS WEB APP:
 *   Deploy > New deployment > Type: Web app
 *   Execute as: Me | Who has access: Anyone
 *   Copy the /exec URL into config.js on the front end.
 */

var MASTER_SHEET = 'Master';
var LOG_SHEET = 'Log';

function doGet(e) {
  try {
    var action = (e.parameter.action || 'summary');
    if (action === 'summary') {
      return jsonOut(buildSummary());
    }
    if (action === 'exportLog') {
      return jsonOut({ rows: getAllLogRows() });
    }
    return jsonOut({ error: 'Unknown action' });
  } catch (err) {
    return jsonOut({ error: String(err) });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000); // queue up to 15s behind other stations rather than fail
  } catch (err) {
    return jsonOut({ error: 'System busy, please rescan in a moment.' });
  }

  try {
    var body = JSON.parse(e.postData.contents);
    var type = body.type;

    if (type === 'scan') {
      return jsonOut(handleScan(body.empNo, body.station));
    }
    if (type === 'uploadMaster') {
      return jsonOut(handleUploadMaster(body.rows));
    }
    if (type === 'clearLog') {
      return jsonOut(handleClearLog(body.confirm));
    }
    return jsonOut({ error: 'Unknown request type' });
  } catch (err) {
    return jsonOut({ error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- core scan logic ---------------- */

function handleScan(rawEmpNo, station) {
  var empNo = String(rawEmpNo || '').trim();
  if (!empNo) return { error: 'Empty scan ignored' };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var master = getOrCreateSheet(ss, MASTER_SHEET, ['EMP_NO', 'EMP_NAME', 'GENDER', 'STATUS']);
  var log = getOrCreateSheet(ss, LOG_SHEET, ['TIMESTAMP', 'EMP_NO', 'EMP_NAME', 'GENDER', 'STATION', 'RESULT']);

  // --- look up in master (cached for 60s so 3730 rows aren't re-read every scan) ---
  var masterMap = getMasterMap(master);
  var record = masterMap[empNo];

  var name = record ? record.name : '';
  var gender = record ? record.gender : '';
  var status = record ? record.status : '';
  var result;

  if (!record) {
    result = 'Mismatch';
  } else if (status && status.toLowerCase().indexOf('inactive') !== -1) {
    result = 'Inactive';
  } else if (isAlreadyRegistered(log, empNo)) {
    result = 'Duplicate';
  } else {
    result = 'Registered';
  }

  var timestamp = new Date();
  log.appendRow([timestamp, empNo, name, gender, station || '', result]);

  return {
    empNo: empNo,
    name: name,
    gender: gender,
    result: result,
    station: station || '',
    timestamp: timestamp.toISOString()
  };
}

function isAlreadyRegistered(log, empNo) {
  var last = log.getLastRow();
  if (last < 2) return false;
  var data = log.getRange(2, 2, last - 1, 6).getValues(); // EMP_NO..RESULT
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === empNo && data[i][4] === 'Registered') {
      return true;
    }
  }
  return false;
}

function getMasterMap(master) {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('masterMap');
  if (cached) return JSON.parse(cached);

  var last = master.getLastRow();
  var map = {};
  if (last >= 2) {
    var data = master.getRange(2, 1, last - 1, 4).getValues();
    for (var i = 0; i < data.length; i++) {
      var id = String(data[i][0]).trim();
      if (!id) continue;
      map[id] = { name: data[i][1], gender: data[i][2], status: data[i][3] };
    }
  }
  try {
    cache.put('masterMap', JSON.stringify(map), 60); // 60s cache
  } catch (err) {
    // master list too large for cache (>100KB) — fine, just skip caching
  }
  return map;
}

/* ---------------- master CSV upload ---------------- */

function handleUploadMaster(rows) {
  if (!rows || !rows.length) return { error: 'No rows received' };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var master = getOrCreateSheet(ss, MASTER_SHEET, ['EMP_NO', 'EMP_NAME', 'GENDER', 'STATUS']);

  master.getRange(2, 1, Math.max(master.getMaxRows() - 1, 1), 4).clearContent();
  var out = rows.map(function (r) {
    return [String(r[0]).trim(), r[1] || '', r[2] || '', r[3] || 'Active'];
  });
  master.getRange(2, 1, out.length, 4).setValues(out);

  CacheService.getScriptCache().remove('masterMap');
  return { uploaded: out.length };
}

/* ---------------- summary for dashboard + live table ---------------- */

function buildSummary() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var master = getOrCreateSheet(ss, MASTER_SHEET, ['EMP_NO', 'EMP_NAME', 'GENDER', 'STATUS']);
  var log = getOrCreateSheet(ss, LOG_SHEET, ['TIMESTAMP', 'EMP_NO', 'EMP_NAME', 'GENDER', 'STATION', 'RESULT']);

  var last = log.getLastRow();
  var rows = [];
  var counts = { Registered: 0, Duplicate: 0, Mismatch: 0, Inactive: 0, Male: 0, Female: 0 };
  var byStation = {};
  var byHour = {};

  if (last >= 2) {
    var data = log.getRange(2, 1, last - 1, 6).getValues();
    for (var i = 0; i < data.length; i++) {
      var ts = data[i][0];
      var empNo = data[i][1], name = data[i][2], gender = data[i][3];
      var station = data[i][4], result = data[i][5];

      rows.push({
        timestamp: ts instanceof Date ? ts.toISOString() : String(ts),
        empNo: empNo, name: name, gender: gender, station: station, result: result
      });

      if (counts[result] !== undefined) counts[result]++;
      if (result === 'Registered') {
        if (gender === 'Male') counts.Male++;
        if (gender === 'Female') counts.Female++;
      }
      var st = station || 'Unknown';
      byStation[st] = (byStation[st] || 0) + 1;

      if (ts instanceof Date) {
        var hourKey = Utilities.formatDate(ts, Session.getScriptTimeZone(), 'HH:00');
        byHour[hourKey] = (byHour[hourKey] || 0) + 1;
      }
    }
  }

  rows.sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });

  return {
    total: rows.length,
    counts: counts,
    byStation: byStation,
    byHour: byHour,
    masterCount: Math.max(master.getLastRow() - 1, 0),
    recent: rows.slice(0, 500) // cap payload size; page keeps its own running table too
  };
}

function getAllLogRows() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var log = getOrCreateSheet(ss, LOG_SHEET, ['TIMESTAMP', 'EMP_NO', 'EMP_NAME', 'GENDER', 'STATION', 'RESULT']);
  var last = log.getLastRow();
  if (last < 2) return [];
  var data = log.getRange(2, 1, last - 1, 6).getValues();
  return data.map(function (row) {
    var ts = row[0];
    return {
      timestamp: ts instanceof Date ? ts.toISOString() : String(ts),
      empNo: row[1], name: row[2], gender: row[3], station: row[4], result: row[5]
    };
  }).sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
}

function handleClearLog(confirm) {
  if (confirm !== 'YES') return { error: 'Confirmation required' };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var log = getOrCreateSheet(ss, LOG_SHEET, ['TIMESTAMP', 'EMP_NO', 'EMP_NAME', 'GENDER', 'STATION', 'RESULT']);
  var last = log.getLastRow();
  if (last >= 2) log.getRange(2, 1, last - 1, 6).clearContent();
  return { cleared: true };
}

/* ---------------- helpers ---------------- */

function getOrCreateSheet(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
