/** The one capability set granted to every rendered workspace HTML document. */
export const HTML_SANDBOX_PERMISSIONS = [
  "allow-downloads",
  "allow-forms",
  "allow-modals",
  "allow-popups",
  "allow-scripts",
  "allow-top-navigation-by-user-activation",
].join(" ");

export const HTML_SANDBOX_CONTENT_SECURITY_POLICY = `sandbox ${HTML_SANDBOX_PERMISSIONS}`;
