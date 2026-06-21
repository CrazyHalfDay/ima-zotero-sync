var chromeHandle;
var scriptContext;

function install(data, reason) {}

async function startup(data, reason) {
  const rootURI = data.rootURI;
  const aomStartup = Components.classes[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Components.interfaces.amIAddonManagerStartup);
  const manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "imazoterosync", rootURI + "content/"],
  ]);

  scriptContext = { rootURI };
  scriptContext._globalThis = scriptContext;
  Services.scriptloader.loadSubScript(
    rootURI + "content/scripts/imazoterosync.js",
    scriptContext,
  );
  await scriptContext.startup(data, reason);
}

async function onMainWindowLoad(data, reason) {
  await scriptContext?.onMainWindowLoad?.(data, reason);
}

async function onMainWindowUnload(data, reason) {
  await scriptContext?.onMainWindowUnload?.(data, reason);
}

async function onPrefsEvent(type, data) {
  await scriptContext?.onPrefsEvent?.(type, data);
}

async function shutdown(data, reason) {
  if (reason !== APP_SHUTDOWN) {
    await scriptContext?.shutdown?.(data, reason);
    if (chromeHandle) {
      chromeHandle.destruct();
      chromeHandle = null;
    }
  }
  scriptContext = null;
}

async function uninstall(data, reason) {}
