/**
 * Metrics and debug logging for Apps Script executions.
 */

function logDebug_(message) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty("DEBUG_LOG") === "true") {
    Logger.log(message);
  }
}

function recordRun_(name, ms, ok) {
  const todayStr = formatDate(new Date(), "yyyy-MM-dd");
  const key = `RUNSTATS_${todayStr}`;
  const props = PropertiesService.getScriptProperties();

  let stats = { runs: 0, ms: 0, errors: 0 };
  const existing = props.getProperty(key);
  if (existing) {
    try {
      const parsed = JSON.parse(existing);
      stats.runs = Number(parsed.runs) || 0;
      stats.ms = Number(parsed.ms) || 0;
      stats.errors = Number(parsed.errors) || 0;
    } catch (e) {
      Logger.log(`[Metrics] Errore parsing metriche esistenti: ${e}`);
    }
  }

  stats.runs += 1;
  stats.ms += Math.round(Number(ms) || 0);
  if (!ok) {
    stats.errors += 1;
  }

  props.setProperty(key, JSON.stringify(stats));
}
