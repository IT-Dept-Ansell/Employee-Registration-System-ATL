/* ==========================================================================
   EDIT THIS ONE LINE after you deploy the Google Apps Script Web App.
   Apps Script Editor -> Deploy -> New deployment -> Web app -> copy the
   URL ending in /exec and paste it below, between the quotes.
   ========================================================================== */
const APP_URL = "https://script.google.com/macros/s/AKfycbxbjOL2JHArlEJefVTyDxczT9vsO5GT5Dab_2gT7gBsQDu1mXHXS5QaFSH5wRIH68oQ/exec";

/* How often each station pulls the shared log to pick up scans made at
   the other 11 stations. 4 seconds keeps the counts feeling live without
   overloading the Apps Script quota across 12 laptops. */
const POLL_MS = 4000;
