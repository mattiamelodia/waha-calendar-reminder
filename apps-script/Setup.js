const APPOINTMENTS_COL_EVENT_ID = 0;
const APPOINTMENTS_COL_CONTACT_NAME = 1;
const APPOINTMENTS_COL_DATE = 2;
const APPOINTMENTS_COL_TIME = 3;

const CLIENTS_COL_NAME = 0;
const CLIENTS_COL_PHONE = 1;
const CLIENTS_COL_LAST_APPOINTMENT = 2;
const CLIENTS_COL_APPOINTMENT_COUNT = 3;

const CACHE_COL_EVENT_ID = 0;
const CACHE_COL_NAME = 1;
const CACHE_COL_PHONE = 2;
const CACHE_COL_DATE = 3;
const CACHE_COL_TIME = 4;

const ARCHIVE_SHEET_NAME = 'Archivio';

const CONFIG_KEYS = {
  CALENDAR_ID: 'CALENDAR_ID',
  REMINDER_START_HOUR: 'REMINDER_START_HOUR',
  REMINDER_START_MINUTE: 'REMINDER_START_MINUTE',
  REMINDER_DURATION_MINUTES: 'REMINDER_DURATION_MINUTES',
  MESSAGE_TEMPLATE: 'MESSAGE_TEMPLATE',
  COUNTRY_CODE: 'COUNTRY_CODE',
  WORDS_TO_REMOVE: 'WORDS_TO_REMOVE',
  REMINDER_CUTOFF_HOUR: 'REMINDER_CUTOFF_HOUR',
  SHEET_ID: 'SHEET_ID',
  ALL_CLIENTS_SHEET_NAME: 'ALL_CLIENTS_SHEET_NAME',
  ALL_APPOINTMENTS_SHEET_NAME: 'ALL_APPOINTMENTS_SHEET_NAME',
  CACHED_APPOINTMENTS_SHEET_NAME: 'CACHED_APPOINTMENTS_SHEET_NAME',
  PHONE_RETRY_MINUTES: 'PHONE_RETRY_MINUTES',
  WEBHOOK_URL: 'WEBHOOK_URL',
  WEBHOOK_SECRET: 'WEBHOOK_SECRET',
  ENABLE_CONFIRMATION_LINKS: 'ENABLE_CONFIRMATION_LINKS',
  CONFIRMATION_DAYS_IN_ADVANCE: 'CONFIRMATION_DAYS_IN_ADVANCE',
  SHORTEN_CONFIRMATION_URLS: 'SHORTEN_CONFIRMATION_URLS',
  FINAL_REMINDER_ENABLED: 'FINAL_REMINDER_ENABLED',
  FINAL_REMINDER_ONLY_CONFIRMED: 'FINAL_REMINDER_ONLY_CONFIRMED',
  MESSAGE_TEMPLATE_FINAL: 'MESSAGE_TEMPLATE_FINAL',
  SALON_NAME: 'SALON_NAME',
  SALON_LOGO_URL: 'SALON_LOGO_URL',
  WAHA_SESSION: 'WAHA_SESSION',
  WEBAPP_URL: 'WEBAPP_URL',
  ADMIN_SECRET: 'ADMIN_SECRET'
};

function setup() {

  const scriptProperties = PropertiesService.getScriptProperties();

  const defaults = {
    [CONFIG_KEYS.CALENDAR_ID]: 'default',
    [CONFIG_KEYS.REMINDER_START_HOUR]: '08',
    [CONFIG_KEYS.REMINDER_START_MINUTE]: '45',
    [CONFIG_KEYS.REMINDER_DURATION_MINUTES]: '45',
    [CONFIG_KEYS.MESSAGE_TEMPLATE]: "Ciao %NOME%, ti chiediamo gentilmente di confermare il tuo appuntamento per %DATA% alle ore %ORE%.\n\nPuoi confermare la tua presenza (o comunicarci una modifica con 1 clic) tramite questo link:\n%LINK%\n\nGrazie per la collaborazione!",
    [CONFIG_KEYS.COUNTRY_CODE]: '39',
    [CONFIG_KEYS.WORDS_TO_REMOVE]: JSON.stringify([]),
    [CONFIG_KEYS.REMINDER_CUTOFF_HOUR]: '24',
    [CONFIG_KEYS.ALL_CLIENTS_SHEET_NAME]: 'Clienti',
    [CONFIG_KEYS.ALL_APPOINTMENTS_SHEET_NAME]: 'Storico',
    [CONFIG_KEYS.CACHED_APPOINTMENTS_SHEET_NAME]: 'CachePromemoria',
    [CONFIG_KEYS.PHONE_RETRY_MINUTES]: '10',
    [CONFIG_KEYS.ENABLE_CONFIRMATION_LINKS]: 'true',
    [CONFIG_KEYS.CONFIRMATION_DAYS_IN_ADVANCE]: '1',
    [CONFIG_KEYS.SHORTEN_CONFIRMATION_URLS]: 'true',
    [CONFIG_KEYS.FINAL_REMINDER_ENABLED]: 'true',
    [CONFIG_KEYS.FINAL_REMINDER_ONLY_CONFIRMED]: 'false',
    [CONFIG_KEYS.MESSAGE_TEMPLATE_FINAL]: "Ciao %NOME%, ti ricordiamo il tuo appuntamento fissato per domani alle ore %ORE%. Ti aspettiamo!",
    [CONFIG_KEYS.SALON_NAME]: "Appuntamenti",
    [CONFIG_KEYS.SALON_LOGO_URL]: "",
    [CONFIG_KEYS.WAHA_SESSION]: "default",
    [CONFIG_KEYS.ADMIN_SECRET]: (typeof Utilities.getUuid === 'function' ? Utilities.getUuid().replace(/[^a-zA-Z0-9]/g, '').slice(0, 16) : 'admin123456')
  };

  const created = [];
  for (const key in defaults) {
    if (setIfMissing_(scriptProperties, key, defaults[key])) {
      created.push(key);
    }
  }

  Logger.log("Configurazione predefinita verificata. Proprietà create: " + (created.length ? created.join(', ') : 'nessuna') + ". Le proprietà già presenti non sono state modificate. Modificabile in 'Impostazioni progetto > Proprietà script'.");

  setupSyncAppointmentsFromCalendar();
  setupDailyCleanupTrigger();
  setupDailyCleanupYesterdayTrigger();
  setupDailyReminderTrigger();

  cleanupObsoleteProperties_();

  Logger.log("Trigger inizializzati.");
}

/**
 * Rimuove eventuali proprietà temporanee o obsolete (vecchie cache SHORT_*,
 * statistiche RUNSTATS_* più vecchie di 7 giorni, token CONFIRM_* più vecchi di 3 giorni
 * e mapping orfani EVENT_CONFIRM_*) per mantenere permanentemente pulite le Script Properties.
 */
function cleanupObsoleteProperties_() {
  try {
    const props = PropertiesService.getScriptProperties();
    const all = props.getProperties();
    let cleaned = 0;
    const now = Date.now();
    const threeDaysMs = 3 * 86400 * 1000;
    const sevenDaysMs = 7 * 86400 * 1000;

    for (const k in all) {
      // 1. Elimina sempre le vecchie cache SHORT_*
      if (k.startsWith('SHORT_')) {
        props.deleteProperty(k);
        cleaned++;
      }
      // 2. Elimina statistiche giornaliere RUNSTATS_* più vecchie di 7 giorni
      else if (k.startsWith('RUNSTATS_')) {
        const dateStr = k.replace('RUNSTATS_', '');
        const d = new Date(dateStr);
        if (!isNaN(d.getTime()) && (now - d.getTime() > sevenDaysMs)) {
          props.deleteProperty(k);
          cleaned++;
        }
      }
      // 3. Elimina token CONFIRM_* più vecchi di 3 giorni
      else if (k.startsWith('CONFIRM_')) {
        try {
          const data = JSON.parse(all[k]);
          if (data && data.createdAt && (now - data.createdAt > threeDaysMs)) {
            props.deleteProperty(k);
            if (data.eventId) props.deleteProperty('EVENT_CONFIRM_' + data.eventId);
            cleaned++;
          }
        } catch (e) {
          props.deleteProperty(k);
          cleaned++;
        }
      }
      // 4. Elimina mapping orfani EVENT_CONFIRM_*
      else if (k.startsWith('EVENT_CONFIRM_')) {
        const token = all[k];
        if (!token || !all['CONFIRM_' + token]) {
          props.deleteProperty(k);
          cleaned++;
        }
      }
    }

    if (cleaned > 0) {
      Logger.log(`cleanupObsoleteProperties_: Rimosse ${cleaned} proprietà temporanee obsolete.`);
    }
  } catch (e) {
    Logger.log('Errore pulizia proprietà obsolete: ' + e);
  }
}

// Writes `value` only when `key` is not set at all (an empty string counts as set).
// Returns true iff it wrote.
function setIfMissing_(props, key, value) {

  if (props.getProperty(key) !== null) {
    return false;
  }

  props.setProperty(key, value);
  return true;
}

function getConfig(key, defaultValue) {

  const scriptProperties = PropertiesService.getScriptProperties();

  const value = scriptProperties.getProperty(key);

  return value !== null ? value : defaultValue;
}

function getCalendar() {

  const calendarId = getConfig(CONFIG_KEYS.CALENDAR_ID, 'default');

  try {

    if (calendarId === 'default') {

      Logger.log("Utilizzo del calendario predefinito.");
      return CalendarApp.getDefaultCalendar();
    } else {

      Logger.log(`Tentativo di accesso al calendario con ID: "${calendarId}".`);
      const calendar = CalendarApp.getCalendarById(calendarId);
      if (!calendar) {
        Logger.log(`Calendario con ID "${calendarId}" non trovato.`);
        return null;
      }
      return calendar;
    }
  } catch (e) {

    Logger.log(`Errore durante l'accesso al calendario configurato con ID "${calendarId}": ${e}`);

    return null;
  }
}