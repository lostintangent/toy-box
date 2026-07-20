import { getServerSetting, parseServerSetting, saveServerSetting } from "../settings.js";
import { getErrorMessage, getRequiredElement } from "../ui.js";

const ui = getOptionsElements();

startOptions();

function startOptions() {
  ui.form.addEventListener("submit", handleSubmit);
  ui.serverUrl.addEventListener("input", handleInput);
  void loadServerSetting();
}

async function loadServerSetting() {
  renderServerSetting(await getServerSetting());
  ui.save.disabled = false;
}

function handleInput() {
  ui.serverUrl.setCustomValidity("");
  renderStatus();
  renderEndpoint(ui.serverUrl.value);
}

async function handleSubmit(event) {
  event.preventDefault();

  let serverUrl;
  try {
    serverUrl = parseServerSetting(ui.serverUrl.value).serverUrl;
  } catch (error) {
    const message = getErrorMessage(error, "Enter a valid Toy Box server URL.");
    ui.serverUrl.setCustomValidity(message);
    ui.serverUrl.reportValidity();
    renderStatus(message, "error");
    return;
  }

  ui.form.toggleAttribute("aria-busy", true);
  ui.save.disabled = true;

  try {
    const setting = await saveServerSetting(serverUrl);
    renderServerSetting(setting);
    renderStatus(`Saved. Inbox tasks will be sent to ${setting.inboxEndpoint}.`, "success");
  } catch (error) {
    renderStatus(getErrorMessage(error, "Couldn’t save the Toy Box server."), "error");
  } finally {
    ui.form.removeAttribute("aria-busy");
    ui.save.disabled = false;
  }
}

function renderEndpoint(value) {
  try {
    ui.inboxEndpoint.textContent = parseServerSetting(value).inboxEndpoint;
  } catch {
    ui.inboxEndpoint.textContent = "—";
  }
}

function renderServerSetting(setting) {
  ui.serverUrl.value = setting.serverUrl;
  ui.inboxEndpoint.textContent = setting.inboxEndpoint;
}

function renderStatus(message = "", state) {
  ui.formStatus.value = message;
  ui.formStatus.dataset.state = state ?? "";
}

function getOptionsElements() {
  return {
    form: getRequiredElement("server-form"),
    serverUrl: getRequiredElement("server-url"),
    inboxEndpoint: getRequiredElement("inbox-endpoint"),
    formStatus: getRequiredElement("form-status"),
    save: getRequiredElement("save"),
  };
}
