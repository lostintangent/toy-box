import { defineWebSocketHandler } from "nitro";
import { socketHooks } from "../socket";

export default defineWebSocketHandler((event) => socketHooks(event.req));
