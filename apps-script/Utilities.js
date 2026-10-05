function updateSentStatus(eventId, isChecked, type) {
  const props = PropertiesService.getScriptProperties();
  const key = type ? `${type}_${eventId}` : eventId;

  if (isChecked) {
    props.setProperty(key, "true");
    if (!type) props.setProperty(eventId, "true");
    Logger.log(`Stato invio impostato per: ${key}`);
  } else {
    props.deleteProperty(key);
    if (!type) props.deleteProperty(eventId);
    Logger.log(`Stato invio resettato per: ${key}`);
  }

  return { success: true };
}

function getSentStatus(eventId, type) {
  const props = PropertiesService.getScriptProperties();
  if (type) {
    return props.getProperty(`${type}_${eventId}`) !== null;
  }
  return props.getProperty(eventId) !== null;
}

function getSentIds_() {
  const props = PropertiesService.getScriptProperties();
  const keys = props.getKeys();
  return new Set(keys);
}

function calculateDateRange(dayType) {
  const today = new Date();

  const startDate = new Date(today);
  const endDate = new Date(today);

  let startOffset = 0;
  let endOffset = 1;

  if (typeof dayType === 'number') {
    startOffset = dayType;
    endOffset = dayType + 1;
  } else {
    const dayOffsets = {
      today: [0, 1],
      tomorrow: [1, 2],
      dayAfterTomorrow: [2, 3],
      in3days: [3, 4],
    };
    if (dayOffsets[dayType]) {
      [startOffset, endOffset] = dayOffsets[dayType];
    } else if (!isNaN(parseInt(dayType, 10))) {
      const num = parseInt(dayType, 10);
      startOffset = num;
      endOffset = num + 1;
    }
  }

  startDate.setDate(today.getDate() + startOffset);
  endDate.setDate(today.getDate() + endOffset);

  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(0, 0, 0, 0);

  return { startDate, endDate };
}

function formatDate(date, format) {

  return Utilities.formatDate(date, Session.getScriptTimeZone(), format);
}

function stripStatusPrefixes_(text) {
  if (!text) return '';
  return text.replace(/^\s*\[(?:OK|SPOSTARE|CONFERMATO|ANNULLATO)\]\s*/i, '');
}

function formatContactName(eventTitle) {
  const strippedTitle = stripStatusPrefixes_(eventTitle).trim();
  const wordsToRemove = getWordsToRemove();
  let contactName = removeTrailingWords(strippedTitle, wordsToRemove);
  return cleanWhitespace(contactName);
}

function getWordsToRemove() {
  try {

    const wordsJson = getConfig(CONFIG_KEYS.WORDS_TO_REMOVE, '[]');
    const words = JSON.parse(wordsJson);
    return Array.isArray(words) ? words : [];

  } catch (e) {

    Logger.log(`Errore durante il parsing della configurazione per "${CONFIG_KEYS.WORDS_TO_REMOVE}": ${e}`);
    return [];

  }
}


function removeTrailingWords(text, words) {
  let result = text;

  for (const word of words) {
    const lowerText = result.toLowerCase();
    const target = " " + word.toLowerCase();

    if (lowerText.endsWith(target)) {

      result = result.substring(0, lowerText.lastIndexOf(target)).trim();
    }

  }

  return result;
}

function cleanWhitespace(text) {

  return text.replace(/\s+/g, " ").trim();
}

function extractFirstName(fullName) {

  return fullName ? fullName.split(" ")[0] : "";
}

function personalizeMessage(template, firstName, date, time, link) {
  let msg = (template || "")
    .replace("%NOME%", firstName || "")
    .replace("%DATA%", date || "")
    .replace("%ORE%", time || "");

  if (link) {
    if (msg.includes("%LINK%")) {
      msg = msg.replace("%LINK%", link);
    } else {
      msg = `${msg}\n\nPer confermare o avvisarci con 1 clic:\n👉 ${link}`;
    }
  } else {
    msg = msg.replace("%LINK%", "").trim();
  }

  return msg;
}

function createWhatsAppLink(phoneNumber, message) {

  return `https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}`;
}

function logAndReturnNull(message) {

  Logger.log(message);

  return null;
}
