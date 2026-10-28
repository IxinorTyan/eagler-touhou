import {defineConfig, loadEnv} from 'vite';
import {reactRouter} from '@react-router/dev/vite';
import {originalBootstrap} from './scripts/ui-rewrite/original-bootstrap.ts';
import {mainAssets} from './scripts/ui-rewrite/main-assets.ts';
import {authoredSources} from './scripts/ui-rewrite/authored-sources.ts';
import {reactDeploymentConfig} from './scripts/ui-rewrite/deployment-config.ts';
import {relative, resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const deployment = reactDeploymentConfig();
const sourceRoot = fileURLToPath(new URL('.', import.meta.url));
// Local UI acceptance can use an existing Host without replacing Vite's UI.
const uiEnvironment = loadEnv('development', sourceRoot, 'EAGLER_UI_');
const uiServer = process.env.EAGLER_UI_SERVER_ORIGIN || uiEnvironment.EAGLER_UI_SERVER_ORIGIN;
const uiSiteManifest = process.env.EAGLER_UI_SITE_MANIFEST || uiEnvironment.EAGLER_UI_SITE_MANIFEST;
const serverProxy = uiServer ? Object.fromEntries([
  '^/(?:site-manifest|host-manifest|runtime-manifest|release-catalog)\\.json(?:\\?|$)',
  '/runtime/', '/netplay-stats/', '/thcrap/', '^/th[0-9]+\\.(?:package\\.json|data)(?:\\?|$)',
].map(path => [path, {target: uiServer, changeOrigin: true}])) : undefined;
export default defineConfig({base: deployment.mountPath,
  // Generated fixtures are not authored UI inputs. Watching them also holds
  // directory handles that block publication/refresh renames on Windows.
  server: {proxy: serverProxy, watch: {ignored: path => /^(?:\.cache|artifacts)(?:\/|$)/.test(relative(sourceRoot, path).replaceAll('\\', '/'))}},
  // The build's preview fetch and listener share one explicit loopback family.
  preview: {host: '127.0.0.1'},
  // Keep generated JavaScript within the browser floor admitted by bootstrap.
  build: {manifest: true, target: 'chrome108'},
  define: {__REACT_APP_SHELL_DEPLOYMENT__: JSON.stringify(deployment.appShell)},
  plugins: [{name: 'local-ui-site-manifest', configureServer(server) {
    if (!uiSiteManifest) return;
    server.middlewares.use((req, res, next) => {
      if (req.url?.split('?')[0] !== deployment.mountPath + 'site-manifest.json') {next();return;}
      try {res.setHeader('Content-Type', 'application/json');res.setHeader('Cache-Control', 'no-store');res.end(readFileSync(resolve(sourceRoot, uiSiteManifest)));}
      catch (error) {next(error);}
    });
  }}, originalBootstrap(), mainAssets(), authoredSources(), reactRouter()], publicDir: false});
