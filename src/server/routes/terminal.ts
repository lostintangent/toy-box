import { defineWebSocketHandler } from "nitro";
import { terminalWebSocket } from "../terminal/websocket";

export default defineWebSocketHandler(terminalWebSocket);
