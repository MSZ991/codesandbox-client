import buildError from './utils/error-message-builder';
import evalModule, { deleteCache } from './eval';
import NoDomChangeError from './errors/no-dom-change-error';
import loadDependencies from './npm';
import sendMessage from './utils/send-message';

import handleExternalResources from './external-resources';
import resizeEventListener from './resize-event-listener';
import setupHistoryListeners from './url-listeners';
import resolveDependency from './eval/js/dependency-resolver';
import setScreen, { resetScreen } from './status-screen';

import {
  getBoilerplates,
  evalBoilerplates,
  findBoilerplate,
} from './boilerplates';

let initializedResizeListener = false;
let loadingDependencies = false;

setScreen({ type: 'loading', stage: 0 });

function getIndexHtml(modules) {
  const module = modules.find(
    m => m.title === 'index.html' && m.directoryShortid == null,
  );
  if (module) {
    return module.code;
  }
  return '<div id="root"></div>';
}

function sendReady() {
  sendMessage('Ready!');
}

function requestRender() {
  sendMessage({ type: 'render' });
}

function initializeResizeListener() {
  const listener = resizeEventListener();
  listener.addResizeListener(document.body, () => {
    if (document.body) {
      sendMessage({
        type: 'resize',
        height: document.body.getBoundingClientRect().height,
      });
    }
  });
  initializedResizeListener = true;
}

async function compile(message) {
  const {
    modules,
    directories,
    boilerplates,
    module,
    changedModule,
    externalResources,
    dependencies,
  } = message.data;

  handleExternalResources(externalResources);

  if (loadingDependencies) return;

  loadingDependencies = true;
  setScreen({ type: 'loading', stage: 1 });
  const { manifest, isNewCombination } = await loadDependencies(dependencies);
  resetScreen();
  loadingDependencies = false;

  if (isNewCombination) {
    // If we just loaded new depdendencies, we want to get the latest changes,
    // since we might have missed them
    requestRender();
    return;
  }

  const { externals } = manifest;

  // Do unmounting
  try {
    if (externals['react-dom']) {
      const reactDOM = resolveDependency('react-dom', externals);
      reactDOM.unmountComponentAtNode(document.body);
      const children = document.body.children;
      for (const child in children) {
        if (
          children.hasOwnProperty(child) &&
          children[child].tagName === 'DIV'
        ) {
          reactDOM.unmountComponentAtNode(children[child]);
        }
      }
    }
  } catch (e) {
    console.error(e);
  }

  try {
    const html = getIndexHtml(modules);
    document.body.innerHTML = html;
    deleteCache(changedModule);

    const evalled = evalModule(module, modules, directories, externals);
    const domChanged = document.body.innerHTML !== html;

    if (!domChanged && !module.title.endsWith('.html')) {
      const isReact = module.code && module.code.includes('React');
      const functionName = evalled.default ? evalled.default.name : '';

      if (isReact) {
        // initiate boilerplates
        if (
          boilerplates.length !== 0 &&
          getBoilerplates().length === 0 &&
          externals != null
        ) {
          try {
            evalBoilerplates(boilerplates, modules, directories, externals);
          } catch (e) {
            console.log("Couldn't load all boilerplates");
          }
        }

        const boilerplate = findBoilerplate(module);
        if (boilerplate) {
          try {
            boilerplate.module.default(evalled);
          } catch (e) {
            throw new NoDomChangeError(isReact, functionName);
          }
        }
      } else {
        throw new NoDomChangeError(isReact, functionName);
      }
    }

    if (!initializedResizeListener) {
      initializeResizeListener();
    }

    sendMessage({
      type: 'success',
    });
  } catch (e) {
    console.log('Error in sandbox:');
    console.error(e);

    e.module = e.module || changedModule;

    sendMessage({
      type: 'error',
      error: buildError(e),
    });
  }
}

window.addEventListener('message', async message => {
  if (message.data.type === 'compile') {
    await compile(message);
  } else if (message.data.type === 'urlback') {
    history.back();
  } else if (message.data.type === 'urlforward') {
    history.forward();
  }
});

sendReady();

setupHistoryListeners();
