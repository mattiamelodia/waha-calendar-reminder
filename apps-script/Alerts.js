/**
 * Gotify alerts for sync failures, missing phone numbers and quota.
 */

function notifyOnce_(key, title, message, priority, cooldownMin) {
  const props = PropertiesService.getScriptProperties();
  const propKey = `LASTNOTIFY_${key}`;
  const lastNotifyMs = Number(props.getProperty(propKey)) || 0;
  const nowMs = new Date().getTime();
  const cooldownMs = (Number(cooldownMin) || 0) * 60 * 1000;

  if (lastNotifyMs > 0 && (nowMs - lastNotifyMs) < cooldownMs) {
    Logger.log(`[Alerts] Notifica "${key}" saltata per cooldown (${cooldownMin} min).`);
    return false;
  }

  notifyGotify(title, message, priority);
  props.setProperty(propKey, String(nowMs));
  return true;
}

function nextFailStreak_(prev, ok) {
  if (ok) return 0;
  return (Number(prev) || 0) + 1;
}

function checkTomorrowNumbers() {
  const cacheSheet = getClientSheet(CONFIG_KEYS.CACHED_APPOINTMENTS_SHEET_NAME);
  const cacheData = cacheSheet.getDataRange().getDisplayValues();

  if (cacheData.length <= 1) return;

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = formatDate(tomorrow, "yyyy-MM-dd");

  let missingCount = 0;
  for (let i = 1; i < cacheData.length; i++) {
    const row = cacheData[i];
    const dateStr = row[CACHE_COL_DATE];
    const phone = row[CACHE_COL_PHONE];

    if (dateStr === tomorrowStr && (!phone || phone.trim() === '')) {
      missingCount++;
    }
  }

  if (missingCount > 0) {
    notifyOnce_(
      "tomorrow_missing",
      "Promemoria Appuntamenti",
      `⚠️ ${missingCount} appuntamenti di domani senza numero`,
      6,
      600
    );
  }
}

function checkQuotaUsage_() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = formatDate(yesterday, "yyyy-MM-dd");
  const key = `RUNSTATS_${yesterdayStr}`;

  const props = PropertiesService.getScriptProperties();
  const statsJson = props.getProperty(key);
  if (!statsJson) return;

  try {
    const stats = JSON.parse(statsJson);
    const msUsed = Number(stats.ms) || 0;
    const quotaMinutes = Number(props.getProperty("QUOTA_MINUTES")) || 90;
    const usedMinutes = msUsed / (60 * 1000);
    const usageRatio = usedMinutes / quotaMinutes;

    if (usageRatio > 0.8) {
      const pct = Math.round(usageRatio * 100);
      notifyOnce_(
        "quota_warning",
        "Avviso Quota Trigger",
        `⚠️ Utilizzo quota trigger al ${pct}% (${Math.round(usedMinutes)} min su ${quotaMinutes} min)`,
        7,
        1440
      );
    }
  } catch (e) {
    Logger.log(`[Alerts] Errore verifica quota: ${e}`);
  }
}

function setupAlertTriggers() {
  Logger.log("Configurazione trigger per checkTomorrowNumbers (8:30)...");
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === "checkTomorrowNumbers") {
      ScriptApp.deleteTrigger(trigger);
      Logger.log("Rimosso trigger esistente per checkTomorrowNumbers.");
    }
  }

  ScriptApp.newTrigger("checkTomorrowNumbers")
    .timeBased()
    .atHour(8)
    .nearMinute(30)
    .everyDays(1)
    .create();

  Logger.log("Trigger giornaliero per checkTomorrowNumbers configurato per le 8:30.");
}
