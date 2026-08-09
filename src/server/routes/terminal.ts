import { defineWebSocketHandler } from "nitro";
import { terminalWebSocket } from "@terminal/server/websocket";

export default defineWebSocketHandler(terminalWebSocket);
