import { physical, rootRoute } from "@tanstack/virtual-file-routes";

export default rootRoute("__root.tsx", [
  physical("."),
  physical("/api", "../features/inbox/routes"),
  physical("/api", "../features/files/routes"),
]);
