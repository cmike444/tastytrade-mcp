export function formatApiError(error: any): string {
  if (error?.response) {
    const status = error.response.status;
    const url = error.response.config?.url ?? error.config?.url ?? "";
    const data = error.response.data;
    let body: string;
    if (typeof data === "string") {
      body = data;
    } else if (data !== null && data !== undefined) {
      try {
        body = JSON.stringify(data);
      } catch {
        body = String(data);
      }
    } else {
      body = "(no response body)";
    }
    const urlPart = url ? ` [${url}]` : "";
    return `HTTP ${status}${urlPart}: ${body}`;
  }
  return error?.message ?? String(error);
}
