// Generate the QVAC worker bundle (the gitignored `qvac/` dir) from
// qvac.config.json. It's a build artifact — required to boot the on-device
// stack — so we regenerate it after `npm install` (via the postinstall hook)
// and offer `npm run setup` to run it by hand. Non-fatal on failure so the
// install still completes; the app will then print a clear error at runtime.
import { bundleSdk } from "@qvac/sdk/commands";

try {
  const r = await bundleSdk({ projectRoot: process.cwd(), quiet: true });
  console.log(`✓ QVAC worker bundle ready: ${r.entryPaths.worker} (${r.plugins.length} plugins, ${r.addons.length} addons)`);
} catch (e) {
  console.warn(`⚠ Could not build the QVAC bundle: ${e?.message ?? e}`);
  console.warn("  The on-device features need it. Run `npm run setup` after a full `npm install`.");
}
process.exit(0);
