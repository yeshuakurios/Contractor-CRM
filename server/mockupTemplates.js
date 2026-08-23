const fs = require('fs');
const path = require('path');

// Both templates share the same section class-name contract (see
// SECTION_GUIDE) so switching which one a lead gets is just a different CSS
// file plus different default colors/fonts/accent-var-name — Claude's job
// (fill content into named sections) doesn't change per template.
const TEMPLATES = [
  {
    id: 'sarab',
    label: 'Warm/editorial (red-orange accent, serif headings)',
    css: fs.readFileSync(path.join(__dirname, 'templates', 'sarab.css'), 'utf8'),
    accentVar: '--primary',
    fontImport:
      '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
      '<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">',
  },
  {
    id: 'clinic',
    label: 'Crisp/trust-forward (blue accent, sans-serif headings)',
    css: fs.readFileSync(path.join(__dirname, 'templates', 'clinic.css'), 'utf8'),
    accentVar: '--accent',
    fontImport:
      '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
      '<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@700;800&family=Roboto:wght@400;500&family=Lato:wght@600;700&display=swap" rel="stylesheet">',
  },
];

// Same section vocabulary for every template — Claude only ever needs to
// learn this once. Both CSS files implement every class listed here.
const SECTION_GUIDE = `Build the page body using EXACTLY this section structure and these class names (both are already fully styled by CSS we provide — do not add inline styles or invent new classes):

<div class="topbar"><div class="container">...phone/email/address in a .topbar-info, social icon links...</div></div>
<nav class="navbar"><div class="container">
  <a class="brand"><!-- logo image or business-name text, per the logo instruction given separately --></a>
  <div class="nav-links">Home / Services / About / Reviews / Contact links (all href="#section-id")</div>
  <a class="btn btn-primary" href="#contact">Book Now / Call Now</a>
</div></nav>

<section class="hero"><div class="container">
  <div>
    <div class="trust-strip"><span class="trust-pill">🛡️ Licensed & Insured</span><span class="trust-pill">⏰ 24/7 Emergency</span><span class="trust-pill">⭐ 4.9/5 Rating</span></div>
    <h1>Bold headline, one word wrapped in <span> for the accent color</h1>
    <p>Subheadline addressing the weaknesses below.</p>
    <div class="hero-cta"><a class="btn btn-primary">Primary CTA</a><a class="btn btn-secondary">Secondary CTA</a></div>
  </div>
  <div class="hero-media">
    <img src="PHOTO_1" alt="...">
    <div class="floating-card top-right"><strong>4.9/5</strong>200+ Reviews</div>
    <div class="floating-card bottom-left"><strong>24/7</strong>Emergency Service</div>
  </div>
</div></section>

<section class="section" id="services"><div class="container">
  <div class="section-head"><span class="section-eyebrow">What We Do</span><h2>Our Services</h2></div>
  <div class="services-grid">3-5 .service-card items (or .services-list of .service-item if using the Clinic-style icon layout), each with a title/description/optional price and a photo or icon</div>
</div></section>

<section class="section about" id="about"><div class="container">
  <img src="PHOTO_2" alt="...">
  <div><span class="section-eyebrow">Why Choose Us</span><h2>...</h2><p>...</p><ul>4-5 checklist items</ul></div>
</div></section>

<section class="section" id="reviews"><div class="container">
  <div class="section-head"><span class="section-eyebrow">Testimonials</span><h2>What Customers Say</h2></div>
  <div class="testimonials-grid">exactly 3 .testimonial-card items — stars, a short generic/illustrative quote, a name + role (never a real person)</div>
</div></section>

<div class="cta-banner"><div class="container"><h2>Ready to book?</h2><p>...</p><a class="btn btn-primary">Call/Book CTA</a></div></div>

<section class="section contact" id="contact"><div class="container">
  <div class="contact-info">address/phone/email/hours rows, each a .contact-row</div>
  <div class="contact-form">Your Name / Email / Phone / Message fields + a Send button (non-functional, visual only)</div>
</div></section>

<footer><div class="container">
  <div class="footer-grid">brand+short blurb, a nav links column, a contact column</div>
  <div class="bottom">© year Business Name. All rights reserved.</div>
</div></footer>

Use PHOTO_1 / PHOTO_2 / etc. (if given below) as literal <img> src values for hero/about photos — do not invent other image URLs. Where a section calls for an icon, use a plain emoji character (no icon font/external library available).`;

function templateById(id) {
  return TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];
}

// Deterministic-ish selection that avoids repeating a template already used
// by another lead in the same market (see leads.js for how usedIds is
// gathered). Hashing the lead id keeps repeated audit runs on the same lead
// consistent rather than flipping templates on every retry.
function pickTemplate(leadId, usedIds) {
  const used = new Set(usedIds || []);
  const available = TEMPLATES.filter((t) => !used.has(t.id));
  const pool = available.length ? available : TEMPLATES;
  const hash = String(leadId).split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return pool[hash % pool.length];
}

module.exports = { TEMPLATES, SECTION_GUIDE, templateById, pickTemplate };
