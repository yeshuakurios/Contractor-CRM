// Detects common third-party booking/review/chat widgets embedded via
// <script src="…">, <iframe src="…">, or similar tags. These widgets render
// their actual content via JavaScript at runtime, so they leave no trace in
// the plain-text view (fetchSite.stripTags) that gets fed to the audit
// prompt — a site can have working online booking or a reviews widget and
// still look, from the stripped text alone, like it has neither. Scanning
// the raw HTML for known widget domains before it's stripped catches that
// case so the audit doesn't wrongly claim the feature is missing.
const FEATURE_SIGNATURES = [
  {
    label: 'online booking/scheduling widget',
    pattern: /calendly\.com|acuityscheduling\.com|squareup\.com\/appointments|setmore\.com|housecallpro\.com|servicetitan\.com|getjobber\.com|schedulicity\.com|simplybook\.me|booksy\.com|mindbodyonline\.com/i,
  },
  {
    label: 'customer reviews widget',
    pattern: /podium\.com|birdeye\.com|trustpilot\.com|elfsight\.com|reviews\.io|grade\.us|nicejob\.co/i,
  },
  {
    label: 'live chat / texting widget',
    pattern: /tawk\.to|intercom\.io|drift\.com|zdassets\.com|livechatinc\.com/i,
  },
  {
    label: 'financing widget',
    pattern: /wisetack\.com|synchronyfinancial\.com|greensky\.com|servicefinance\.com/i,
  },
];

function detectEmbeddedFeatures(html) {
  return FEATURE_SIGNATURES.filter(({ pattern }) => pattern.test(html)).map(({ label }) => label);
}

module.exports = { detectEmbeddedFeatures };
