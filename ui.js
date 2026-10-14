/* Shared UI helpers. All stored/user text goes through textContent. */
var UI = {
  async send(action, data = {}) {
    const result = await chrome.runtime.sendMessage({ action, ...data });
    if (!result?.success) throw Error(result?.error || "TabFolio is unavailable. Reload the extension and try again.");
    return result;
  },
  el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  },
  button(text, onClick, className = "") {
    const button = UI.el("button", className, text);
    button.type = "button";
    button.addEventListener("click", async () => {
      button.disabled = true;
      try { await onClick(); } catch (err) { UI.status(err.message, true); }
      finally { button.disabled = false; }
    });
    return button;
  },
  status(message, error = false) {
    const el = document.getElementById("status");
    el.textContent = message;
    el.hidden = !message;
    el.className = "status" + (error ? " error" : "");
  },
  hostname(url) { try { return new URL(url).hostname || url; } catch { return url || "New tab"; } },
  async act(action, data) {
    const result = await UI.send(action, data);
    if (result.message) UI.status(result.message);
    return result;
  },
  openPage(page) { return chrome.tabs.create({ url: chrome.runtime.getURL(page) }); },
  // Native dialog provides Escape handling, focus containment and focus return.
  confirm(title, message, label = "Continue", danger = false) {
    return new Promise(resolve => {
      const dialog = UI.el("dialog");
      const heading = UI.el("h2", "", title); heading.id = "dialog-title";
      dialog.setAttribute("aria-labelledby", heading.id);
      dialog.append(heading, UI.el("p", "", message));
      const actions = UI.el("div", "actions");
      actions.append(UI.button("Cancel", () => dialog.close()), UI.button(label, () => dialog.close("confirm"), danger ? "danger" : "primary"));
      dialog.append(actions); document.body.append(dialog);
      dialog.addEventListener("close", () => { const yes = dialog.returnValue === "confirm"; dialog.remove(); resolve(yes); });
      dialog.showModal();
    });
  }
};
