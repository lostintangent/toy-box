import { captureViewport, sendPageToInbox } from "../inbox.js";
import { getErrorMessage, getRequiredElement } from "../ui.js";

const SUBMISSION_STATES = {
  loading: { label: "Send", disabled: true },
  ready: { label: "Send", disabled: false },
  sending: { label: "Sending…", disabled: true, busy: true },
  sent: { label: "Sent", disabled: true },
  error: { label: "Try again", disabled: false },
  unavailable: { label: "Unavailable", disabled: true },
};

const ui = getPopupElements();
const state = {
  page: { title: "Current page", url: "", selection: "" },
  viewport: undefined,
  submission: "loading",
};

startPopup();

function startPopup() {
  ui.form.addEventListener("submit", handleSubmit);
  ui.prompt.addEventListener("keydown", handlePromptKeyDown);
  ui.removeSelection.addEventListener("click", removeSelection);
  ui.removeViewport.addEventListener("click", removeViewport);

  setSubmission("loading");
  void initializePageContext();
}

async function initializePageContext() {
  try {
    const tab = await getActiveTab();
    state.page = {
      title: tab.title?.trim() || "Current page",
      url: tab.url,
      selection: "",
    };
    renderPageSummary();

    const [selection, viewport] = await Promise.all([
      getPageSelection(tab.id),
      captureViewport(tab.windowId),
    ]);

    state.page = { ...state.page, selection };
    state.viewport = viewport;
    renderSelection();
    renderViewport();
    setSubmission("ready");
  } catch (error) {
    setSubmission("unavailable", getErrorMessage(error, "The current page is unavailable."));
  }
}

async function handleSubmit(event) {
  event.preventDefault();

  if (state.submission !== "ready" && state.submission !== "error") return;

  const task = ui.prompt.value.trim();
  if (!task || !state.page.url) return;

  setSubmission("sending", "Sending to Toy Box.");

  try {
    await sendPageToInbox({ task, page: state.page, viewport: state.viewport });
    setSubmission("sent", "Sent to Toy Box.");
    window.setTimeout(() => window.close(), 250);
  } catch (error) {
    setSubmission("error", getErrorMessage(error, "Couldn’t send this prompt."));
  }
}

function handlePromptKeyDown(event) {
  if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;

  event.preventDefault();
  ui.form.requestSubmit();
}

function removeSelection() {
  state.page = { ...state.page, selection: "" };
  renderSelection();
  ui.prompt.focus();
}

function removeViewport() {
  state.viewport = undefined;
  renderViewport();
  ui.prompt.focus();
}

function renderPageSummary() {
  ui.pageTitle.textContent = state.page.title;
  ui.pageTitle.title = state.page.title;
  ui.pageUrl.textContent = state.page.url;
  ui.pageUrl.title = state.page.url;
}

function renderSelection() {
  ui.selectionText.textContent = state.page.selection;
  ui.selection.hidden = !state.page.selection;
}

function renderViewport() {
  if (state.viewport) {
    ui.viewportImage.src = state.viewport;
  } else {
    ui.viewportImage.removeAttribute("src");
  }

  ui.viewport.hidden = !state.viewport;
}

function setSubmission(submission, message = "") {
  const config = SUBMISSION_STATES[submission];
  state.submission = submission;

  ui.submit.disabled = config.disabled;
  ui.submit.title = message;
  ui.submit.toggleAttribute("aria-busy", Boolean(config.busy));
  ui.submit.setAttribute("aria-label", message ? `${config.label}. ${message}` : config.label);
  ui.spinner.hidden = !config.busy;
  ui.submitLabel.textContent = config.label;
  ui.formStatus.value = message;
}

async function getActiveTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

  if (typeof tab?.id !== "number" || !tab.url) {
    throw new Error("The current page is unavailable.");
  }

  return tab;
}

async function getPageSelection(tabId) {
  try {
    const [injection] = await browser.scripting.executeScript({
      target: { tabId },
      func: readPageSelection,
    });

    return injection?.result?.trim() ?? "";
  } catch {
    // Browsers do not allow script injection on internal or otherwise protected pages.
    return "";
  }
}

function readPageSelection() {
  const activeElement = document.activeElement;

  if (activeElement instanceof HTMLInputElement && activeElement.type === "password") {
    return "";
  }

  if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement) {
    const start = activeElement.selectionStart;
    const end = activeElement.selectionEnd;

    if (typeof start === "number" && typeof end === "number" && start !== end) {
      return activeElement.value.slice(start, end);
    }
  }

  return window.getSelection()?.toString() ?? "";
}

function getPopupElements() {
  return {
    form: getRequiredElement("prompt-form"),
    prompt: getRequiredElement("prompt"),
    submit: getRequiredElement("submit"),
    submitLabel: getRequiredElement("submit-label"),
    spinner: getRequiredElement("submit-spinner"),
    formStatus: getRequiredElement("form-status"),
    pageTitle: getRequiredElement("page-title"),
    pageUrl: getRequiredElement("page-url"),
    selection: getRequiredElement("selection-container"),
    selectionText: getRequiredElement("selection-text"),
    removeSelection: getRequiredElement("remove-selection"),
    viewport: getRequiredElement("viewport-container"),
    viewportImage: getRequiredElement("viewport-image"),
    removeViewport: getRequiredElement("remove-viewport"),
  };
}
