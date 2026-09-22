import { compressResponseStream } from "h3-compression";
import { onResponse } from "h3";

export default onResponse(async (response, event) => {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
  // Keep SSE and framed server-function streams outside compression so they flush immediately.
  if (contentType !== "text/html" && contentType !== "application/json") return;

  const compressed = await compressResponseStream(event, response);
  compressed.headers.append("Vary", "Accept-Encoding");
  return compressed;
});
