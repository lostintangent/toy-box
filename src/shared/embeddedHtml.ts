/** Shared policy and document preparation for sandboxed embedded HTML. */
export const HTML_SANDBOX_PERMISSIONS = [
  "allow-downloads",
  "allow-forms",
  "allow-modals",
  "allow-popups",
  "allow-scripts",
  "allow-top-navigation-by-user-activation",
].join(" ");

export const HTML_SANDBOX_CONTENT_SECURITY_POLICY = `sandbox ${HTML_SANDBOX_PERMISSIONS}`;
export const HTML_BASE_ATTRIBUTE = "data-toybox-file-base";

/** Make relative resources in a srcdoc document resolve from its owning file directory. */
export function injectBaseHref(html: string, baseUri: string): string {
  const baseTag = `<base ${HTML_BASE_ATTRIBUTE} href="${baseUri}" />`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (head) => `${head}${baseTag}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (htmlTag) => `${htmlTag}<head>${baseTag}</head>`);
  }

  return `<head>${baseTag}</head>${html}`;
}
