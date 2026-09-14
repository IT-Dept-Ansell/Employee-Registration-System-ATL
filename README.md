# Employee Registration System — Setup Guide

## How it avoids clashes across the 12 stations

GitHub Pages only serves files — it can't store data or referee 12 laptops
writing at once. So this system has two parts:

1. **The 12 laptops** all open the *same* front-end pages (`index.html` /
   `dashboard.html`), hosted anywhere static — GitHub Pages is fine.
2. **One shared Google Sheet**, driven by a small Google Apps Script, acts
   as the database. Every scan from every station goes through one Web App
   URL. Inside that script, each request runs inside a `LockService` lock —
   so if two stations scan at the exact same instant, the second request
   automatically waits until the first has finished checking for
   duplicates and writing its row. That's what guarantees no clash and no
   missing record, and it also means your data lives in an actual Google
   Sheet you can open, filter, and hand off — no separate database to run.

Total build time is about 10 minutes, all of it clicking through Google's
UI — no server to host or maintain.

## 1. Create the Google Sheet + script

1. Go to **sheets.google.com** → create a new blank sheet. Name it
   `Employee Registration DB`.
2. In the sheet, go to **Extensions → Apps Script**.
3. Delete the placeholder code and paste in the entire contents of
   `Code.gs` (included here).
4. Click **Save** (the disk icon), name the project `ERS Backend`.
5. Click **Deploy → New deployment**.
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Click **Deploy**, then **Authorize access** and approve the permissions
   (it's your own script, on your own sheet).
7. Copy the URL that ends in `/exec` — this is your `APP_URL`.

The script auto-creates two tabs the first time it runs: `Master` (your
employee list) and `Log` (every scan, including duplicates/mismatches).

## 2. Load your master database

Easiest path: open the `Master` tab in the sheet and paste your 3,730-row
CSV straight in (File → Import → Upload, "Replace current sheet" or
"Append"), with columns in this order:

```
EMP_NO | EMP_NAME | GENDER | STATUS
```

`STATUS` is optional — leave it blank and everyone is treated as Active.
**To make the "inactive employees" check work, your real master CSV needs
a STATUS column marking who's inactive** (e.g. `Active` / `Inactive`) —
your sample data didn't include one, so add it when you export the real
3,730-row list.

Alternative path: use the **Upload master CSV** button on the Dashboard
page instead of pasting into Sheets directly — same result, and you can
re-upload any time the master list changes (it replaces the whole list).
`sample-master.csv` (included here) is the 16 rows from your message,
ready to test with.

## 3. Configure the front end

Open `config.js` and paste your Web App URL:

```js
const APP_URL = "https://script.google.com/macros/s/XXXXXXXX/exec";
```

That's the only file you need to edit. Both pages read from it.

## 4. Host the two pages

Push `index.html`, `dashboard.html`, `styles.css`, `config.js`, `app.js`,
`dashboard.js` to a GitHub repo and turn on **GitHub Pages** (Settings →
Pages → Deploy from branch). You'll get one link, e.g.
`https://yourname.github.io/ers/` — that's the link all 12 laptops open.

## 5. Set up each station

On first load, each laptop asks **"Which station is this laptop?"** —
enter 1 through 12. It's saved in that browser (`localStorage`), so it
only asks once. Point each barcode reader's focus at the big input box at
the top of the Scan Station page (it auto-focuses and refocuses after
every scan) — most USB barcode readers act as a keyboard and send
`Enter` after the code, which is what triggers registration here.

## What each result means

| Badge | Meaning |
|---|---|
| **Registered** (teal) | First time this ID has been scanned — added to the log |
| **Duplicate** (amber) | This ID was already registered, at this or another station |
| **Mismatch** (red) | ID not found in the Master tab |
| **Inactive** (grey) | ID found, but its STATUS is Inactive |

The Scan Station page shows a live feed and running Total / Male / Female
counts, polling the shared sheet every 4 seconds so scans from the other
11 stations appear here too. The Dashboard page adds four charts
(result breakdown, gender split, per-station scan counts so you can
visually confirm no station is being missed or double-counted, and
scans-by-hour) plus CSV export of the full log.

## Notes on scale

3,730 master rows and a growing log are well within what Apps Script
handles comfortably for this request volume (12 stations, human scan
speed). If you later want sub-second sync instead of a 4-second poll, or
expect much higher volume, the same front end can point at Firebase
instead — happy to swap that in if you outgrow this.
