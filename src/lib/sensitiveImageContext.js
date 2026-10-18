function isPaymentCardText(text) {
  return /\b(?:BOB\s*CARD|VISA|MASTERCARD|MASTER CARD|RUPAY|AMEX|AMERICAN EXPRESS|DISCOVER|DINERS CLUB)\b/i.test(text) ||
    /\b(?:credit|debit|payment)\s*card\b/i.test(text) ||
    (/\bcard\b/i.test(text) && /\b(?:CVV|CVC|expiry|expires|valid thru|valid through|cardholder|card number|card no\.?)\b/i.test(text));
}

module.exports = { isPaymentCardText };