export const CONNECTION_MESSAGE = "Seaweed Harvest cannot reach its online service from this connection. Try another network, then retry. Saved offline records are kept on this device.";

export function isConnectionError(error) {
  if (error?.name === "ConnectionTimeoutError") return true;
  const message = String(error?.message || "");
  return /failed to fetch|fetch failed|networkerror|network request failed|network connection (?:was )?lost|load failed|(?:connection|request) timed out|failed to send a request to the edge function/i.test(message);
}

export function connectionErrorMessage(error, fallback = "The request could not be completed.") {
  return isConnectionError(error) ? CONNECTION_MESSAGE : String(error?.message || fallback);
}

// For startup reads only. A timeout aborts the read and never replays a request.
export async function readWithDeadline(read, timeoutMs = 12000) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error("Connection timed out while opening the form.");
      error.name = "ConnectionTimeoutError";
      reject(error);
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => read(controller.signal)),
      deadline
    ]);
  } finally {
    clearTimeout(timer);
  }
}
