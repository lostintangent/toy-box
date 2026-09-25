import { index, physical, rootRoute } from "@tanstack/virtual-file-routes";

export default rootRoute("__root.tsx", [
  index("index.tsx"),
  physical("/api", "api"),
  physical("/api", "../../inbox/routes"),
  physical("/api", "../../files/routes"),
  physical("/api", "../../channels/routes"),
]);
