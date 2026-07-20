import { captureViewport, sendPageToInbox } from "./inbox.js";

const MENU = {
  root: "send-to-toy-box",
  custom: "send-custom-prompt",
  separator: "quick-actions-separator",
};

const QUICK_ACTIONS = new Map([
  [
    "summarize-page",
    {
      title: "Summarize page",
      task: "Read the page and produce a concise summary of its main argument, important evidence, and practical takeaways.",
    },
  ],
  [
    "research-applicability",
    {
      title: "Research applicability",
      task: "Read the page, then investigate my recent local projects and determine where its ideas, techniques, or findings are applicable. Return concrete connections, likely benefits, constraints, and worthwhile next steps.",
    },
  ],
]);

const badgeClearTimers = new Map();

browser.runtime.onInstalled.addListener(() => {
  void installContextMenus().catch((error) => {
    console.error("Failed to install the Toy Box context menus:", error);
  });
});

browser.contextMenus.onClicked.addListener((info, tab) => {
  const menuId = String(info.menuItemId);

  if (menuId === MENU.custom) {
    if (typeof tab?.windowId !== "number") return;

    void browser.action.openPopup({ windowId: tab.windowId }).catch((error) => {
      console.error("Failed to open the Toy Box popup:", error);
    });
    return;
  }

  const task = QUICK_ACTIONS.get(menuId)?.task;
  if (!task || typeof tab?.id !== "number") return;

  void runQuickAction(task, info, tab);
});

async function installContextMenus() {
  await browser.contextMenus.removeAll();

  browser.contextMenus.create({
    id: MENU.root,
    title: "Send to Toy Box",
    contexts: ["all"],
  });

  browser.contextMenus.create({
    id: MENU.custom,
    parentId: MENU.root,
    title: "Custom prompt…",
    contexts: ["all"],
  });

  browser.contextMenus.create({
    id: MENU.separator,
    parentId: MENU.root,
    type: "separator",
    contexts: ["all"],
  });

  for (const [id, { title }] of QUICK_ACTIONS) {
    browser.contextMenus.create({
      id,
      parentId: MENU.root,
      title,
      contexts: ["all"],
    });
  }
}

async function runQuickAction(task, info, tab) {
  cancelBadgeClear(tab.id);
  const viewportPromise = captureViewport(tab.windowId);
  await showBadge(tab.id, "…", "#64748b");

  try {
    const page = getPageContext(info, tab);
    const viewport = await viewportPromise;

    await sendPageToInbox({ task, page, viewport });
    await showBadge(tab.id, "✓", "#15803d");
  } catch (error) {
    console.error("Failed to send the Toy Box quick action:", error);
    await showBadge(tab.id, "!", "#b91c1c");
  }

  scheduleBadgeClear(tab.id);
}

function getPageContext(info, tab) {
  return {
    title: tab.title,
    url: tab.url || info.pageUrl,
    selection: info.selectionText,
    linkUrl: info.linkUrl,
    mediaUrl: info.srcUrl,
  };
}

async function showBadge(tabId, text, color) {
  await Promise.allSettled([
    browser.action.setBadgeText({ tabId, text }),
    browser.action.setBadgeBackgroundColor({ tabId, color }),
  ]);
}

function scheduleBadgeClear(tabId) {
  cancelBadgeClear(tabId);

  const timer = setTimeout(() => {
    badgeClearTimers.delete(tabId);
    void browser.action.setBadgeText({ tabId, text: "" }).catch(() => {});
  }, 2500);

  badgeClearTimers.set(tabId, timer);
}

function cancelBadgeClear(tabId) {
  const timer = badgeClearTimers.get(tabId);
  if (timer === undefined) return;

  clearTimeout(timer);
  badgeClearTimers.delete(tabId);
}
