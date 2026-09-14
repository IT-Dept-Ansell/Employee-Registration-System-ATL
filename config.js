/* ==========================================================================
   EDIT THIS ONE LINE after you deploy the Google Apps Script Web App.
   Apps Script Editor -> Deploy -> New deployment -> Web app -> copy the
   URL ending in /exec and paste it below, between the quotes.
   ========================================================================== */
const APP_URL = "no api url";

/* How often each station pulls the shared log to pick up scans made at
   the other 11 stations. 4 seconds keeps the counts feeling live without
   overloading the Apps Script quota across 12 laptops. */
const POLL_MS = 4000;
