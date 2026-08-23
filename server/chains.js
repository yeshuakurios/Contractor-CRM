// Known national/regional plumbing franchise and chain brands — excluded
// from imports since the whole pitch is aimed at independent operators who
// don't already have franchise-level marketing/tech support. Matched as a
// case-insensitive substring against the business name, since Places API
// doesn't expose any "is this a franchise" signal to check against directly.
const CHAIN_BRANDS = [
  'roto-rooter', 'roto rooter',
  'mr. rooter', 'mr rooter',
  'benjamin franklin plumbing',
  'ars/rescue rooter', 'ars rescue rooter', 'rescue rooter',
  'one hour heating', 'one hour air',
  'aire serv',
  'michael & son', 'michael and son',
  'american leak detection',
  'zoom drain',
  'len the plumber',
  'abacus plumbing',
  'any hour services',
  'eco plumbers',
  '1-800-plumber', '1800 plumber', '1-800-plumber,+air',
  'goettl',
  'john moore',
  'the pink plumber',
  'parker & sons', 'parker and sons',
  'mrooter',
  '1-tom-plumber', '1 tom plumber',
];

function isLikelyChain(businessName) {
  const name = (businessName || '').toLowerCase();
  return CHAIN_BRANDS.some((brand) => name.includes(brand));
}

module.exports = { isLikelyChain, CHAIN_BRANDS };
