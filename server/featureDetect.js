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

// Plain-text trust signals a plumbing-site audit commonly claims are
// "missing" — licensing/insurance, warranties, free estimates, years-in-
// business, star ratings — even when the visible copy states them outright.
// This is a straight keyword check over the already-stripped site text, so
// it catches the case the LLM analysis itself misses or glosses over: the
// text plainly says "Licensed and Insured" or "1-year warranty" but the
// generated weakness list claims no licensing/warranty info is shown.
const TEXT_SIGNATURES = [
  { label: 'licensing/insurance mention', pattern: /\blicens(e|ed|ing)\b|\binsured\b/i },
  { label: 'warranty/guarantee mention', pattern: /\bwarrant(y|ies)\b|\bguarantee[ds]?\b/i },
  { label: 'free estimate/pricing mention', pattern: /\bfree estimate|no[- ]cost estimate|transparent pricing|upfront pricing|no[- ]obligation quote\b/i },
  { label: 'years-in-business mention', pattern: /\b\d{1,3}\+?\s*years?\b/i },
  { label: 'star rating or review count', pattern: /\b\d(\.\d)?\s*(\/\s*5|out of 5|star)|ratings?\s*&?\s*reviews?/i },
];

function detectTextSignals(siteText) {
  return TEXT_SIGNATURES.filter(({ pattern }) => pattern.test(siteText)).map(({ label }) => label);
}

module.exports = { detectEmbeddedFeatures, detectTextSignals };
