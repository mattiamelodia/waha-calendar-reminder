/**
 * Webhook endpoint per ricevere eventi in tempo reale da WAHA (WhatsApp HTTP API).
 */

/**
 * Gestisce le richieste POST in entrata da webhook esterni.
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(
        JSON.stringify({ status: 'ignored', reason: 'empty_post_data' })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    let data;
    try {
      data = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return ContentService.createTextOutput(
        JSON.stringify({ status: 'error', reason: 'invalid_json', message: parseErr.message })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    // Eventi webhook esterni (es. message.ack, session.status, etc.)
    return ContentService.createTextOutput(
      JSON.stringify({ status: 'received', event: data.event || 'unknown' })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    Logger.log('Errore critico in doPost: ' + err.message);
    return ContentService.createTextOutput(
      JSON.stringify({ status: 'error', message: err.message })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}
