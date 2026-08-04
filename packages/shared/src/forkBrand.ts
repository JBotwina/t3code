/**
 * Fork identity for T2 Code.
 *
 * This fork installs side by side with an upstream T3 Code build, so every
 * string that makes an OS treat the two as *different applications* lives
 * here and nowhere else: bundle id, app name, deep-link scheme, user-data
 * directory, and the `~/.t2` home its embedded server writes to.
 *
 * Keeping them in one file is what makes upstream merges cheap — call sites
 * reference `FORK_BRAND.*` on a single line, so a merge only conflicts when
 * upstream edits that same line, and rebranding never touches call sites
 * again. Cosmetic prose elsewhere in the product still says "T3 Code"; that
 * is deliberate — rewriting copy would conflict on every upstream change for
 * no functional gain.
 */
export const FORK_BRAND = {
  /** Product name: .app bundle name, Spotlight, Dock, window title. */
  baseName: "T2 Code",
  /** Reverse-DNS bundle id. Must differ from upstream's com.t3tools.t3code. */
  appId: "io.jamesbotwina.t2code",
  appIdDev: "io.jamesbotwina.t2code.dev",
  /** Deep-link scheme; also the renderer origin (t2code://app/). */
  scheme: "t2code",
  schemeDev: "t2code-dev",
  /** Electron userData directory name under the platform app-data dir. */
  userDataDirName: "t2code",
  userDataDirNameDev: "t2code-dev",
  /** Server home directory under $HOME — keeps state out of upstream's ~/.t3. */
  homeDirName: ".t2",
  /** electron-builder artifact prefix, e.g. T2-Code-0.0.31-arm64.dmg. */
  artifactPrefix: "T2-Code",
  /** Linux executable name and StartupWMClass. */
  linuxExecutableName: "t2code",
} as const;

export type ForkBrand = typeof FORK_BRAND;
