/**
 * Phone number normalization.
 *
 * formatPhoneNumber returns the digits of the number in international format without "+"
 * (e.g. country code + national number), or null when the number cannot be recognised. It never guesses:
 * an unrecognised number yields null, not a wrong number.
 */

function formatPhoneNumber(number) {

  if (!number)
    return logAndReturnNull("[Formatta Numero] Nessun numero fornito.");

  const countryCode = getConfig(CONFIG_KEYS.COUNTRY_CODE, "39");

  const cleaned = sanitizePhoneNumber(number);

  // A leading "+" or "00" marks an international number: digits are returned as they are.
  const isInternational = /^(\+|00)/.test(cleaned);
  const digits = cleaned.replace(/^(\+|00)/, "");

  if (!/^\d+$/.test(digits)) {

    return logAndReturnNull(
      `[Formatta Numero] Numero "${number}" (pulito: "${cleaned}") non riconosciuto per il prefisso ${countryCode}.`
    );
  }

  if (isInternational) {

    // For numbers of our own country keep checking the length (logs an anomaly, returns as is).
    return digits.startsWith(countryCode)
      ? validateCountryPrefixedNumber(digits, countryCode)
      : digits;
  }

  if (countryCode === "39" && digits.length === 12 && digits.startsWith(countryCode)) {

    return digits;
  }

  // Checked before the generic prefix rule: "391 234 5678" is a mobile number starting with 39.
  if (isItalianMobileNumber(digits, countryCode)) {

    return countryCode + digits;
  }

  if (digits.startsWith(countryCode)) {

    return validateCountryPrefixedNumber(digits, countryCode);
  }

  return logAndReturnNull(
    `[Formatta Numero] Numero "${number}" (pulito: "${cleaned}") non riconosciuto per il prefisso ${countryCode}.`
  );
}

function sanitizePhoneNumber(number) {

  return String(number).replace(/[\s\-().\/]/g, "");
}

function formatPhoneForDisplay(phone) {

  if (!phone) return "";

  // Italian mobile/landline in full form: "+39 347 123 4567".
  if (/^39\d{10}$/.test(phone)) {
    const onlyNumbers = phone.substring(2);
    return `+39 ${onlyNumbers.slice(0, 3)} ${onlyNumbers.slice(3, 6)} ${onlyNumbers.slice(6)}`;
  }

  // Any other number is international digits: show it with a "+".
  if (/^\d+$/.test(phone)) return `+${phone}`;

  return phone;
}

function validateCountryPrefixedNumber(number, countryCode) {

  if (countryCode === "39" && number.length !== 12) {

    Logger.log(
      `[Formatta Numero] Numero con prefisso IT (${countryCode}) ma lunghezza anomala: ${number.length} caratteri per il numero "${number}".`
    );

  }

  return number;
}

function isItalianMobileNumber(number, countryCode) {

  return countryCode === "39" && number.length === 10 && number.startsWith("3");
}
