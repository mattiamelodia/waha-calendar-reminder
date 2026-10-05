/**
 * Lock management for concurrent executions.
 *
 * withScriptLock_ runs `fn` under a script-level lock using tryLock(timeoutMs).
 * If the lock cannot be acquired within timeoutMs, fn is not executed and { ran: false } is returned.
 * The lock is always released in a finally block, even if fn throws.
 */
function withScriptLock_(timeoutMs, fn) {
  const lock = LockService.getScriptLock();
  const acquired = lock.tryLock(timeoutMs);

  if (!acquired) {
    Logger.log(`[Lock] Impossibile acquisire il lock entro ${timeoutMs}ms. Esecuzione saltata.`);
    return { ran: false };
  }

  try {
    const value = fn();
    return { ran: true, value: value };
  } finally {
    try {
      lock.releaseLock();
    } catch (e) {
      Logger.log(`[Lock] Errore nel rilascio del lock: ${e}`);
    }
  }
}
