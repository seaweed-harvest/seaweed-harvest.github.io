// Only retry read-only account verification. Never replay backup writes or deletes.
export async function readBackupAccess(read, { onRetry = () => {}, timeoutMs = 15000, retryDelayMs = 400 } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(read),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Account verification timed out.")), timeoutMs);
        })
      ]);
    } catch (error) {
      // Permission denials, invalid sessions and missing profiles need an explicit result.
      // Only connection failures are eligible for a single automatic retry.
      const message = String(error?.message || "");
      const transient = /failed to fetch|network|load failed|timed out|timeout/i.test(message);
      if (attempt || !transient) throw error;
      onRetry();
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    } finally {
      clearTimeout(timer);
    }
  }
}
