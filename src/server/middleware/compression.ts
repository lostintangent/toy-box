import { compressResponseStream } from "h3-compression";
import { onResponse } from "h3";

export default onResponse(async (response, event) => {
  if (!response.headers.get("content-type")?.startsWith("text/html")) return;

  const compressed = await compressResponseStream(event, response);
  compressed.headers.append("Vary", "Accept-Encoding");
  return compressed;
});
