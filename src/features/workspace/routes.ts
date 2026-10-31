import { existsSync, readdirSync } from "node:fs";
import { index, physical, rootRoute } from "@tanstack/virtual-file-routes";

// The router generator evaluates this file at dev and build time to write
// routeTree.gen.ts, so it reads the source tree rather than shipping in the app.
// Each feature's `routes/` folder serves its HTTP API under `/api`. Workspace
// owns the app shell, so its own routes folder is the router's root.
const features = new URL("../", import.meta.url);
const featuresWithRoutes = readdirSync(features).filter(
  (feature) => feature !== "workspace" && existsSync(new URL(`${feature}/routes`, features)),
);

export default rootRoute("__root.tsx", [
  index("index.tsx"),
  physical("/api", "api"),
  ...featuresWithRoutes.map((feature) => physical("/api", `../../${feature}/routes`)),
]);
