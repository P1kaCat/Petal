# Setup & development

[Back to Petal](../README.md)

## Run the source

On Windows, install Node.js 24 or later, pnpm 11, and Git:

```powershell
git clone https://github.com/P1kaCat/Petal.git
cd Petal
pnpm install --frozen-lockfile
pnpm start
```

Petal uses Electron with HTML, CSS, and JavaScript, and the `@xmcl` libraries
for Minecraft installation and launch preparation. No UI compilation is needed.
The app interface uses English labels.

## Create your first instance

1. Choose **New profile**, a Minecraft version, and Fabric, Forge, or NeoForge.
2. Search in **Discover**. The active profile filters by game version and loader.
3. Choose **Install** to install a mod and required dependencies from its source.
4. In **My profiles**, choose **Install game** to download game files, Java,
   and the loader. The first preparation may download more than 1 GB.
5. Configure Microsoft authentication in **Settings**, then choose **Play**.

Saves, mods, and configuration are separated per profile. You can enable,
disable, remove, and update individual mods. Removed files are kept in the
instance's `removed` folder. **Folder** opens the instance, including game logs.

## CurseForge

Apply for your own authorized key through the
[official process](https://support.curseforge.com/support/solutions/articles/9000208346-about-the-curseforge-api-and-how-to-apply-for-a-key),
and review the API terms for your intended use. Enter the key under
**Settings → CurseForge**. It is encrypted using Windows secure storage and is
not exposed back to the renderer. A blank field preserves an existing key;
the removal checkbox deletes it.

Without a key, Modrinth remains available. A file without an API download URL
is not downloaded automatically. Use its official project page, obtain the
file if permitted, and use **Import a .jar**. Manual imports require you to
check compatibility and dependencies.

Authenticated CurseForge downloads have not been verified. Before wider
distribution, validate current API and CDN authentication requirements and
confirm an approved API-key handling model. A key bundled in a desktop binary
cannot be treated as secret. Do not commit keys or put them in screenshots.

## Microsoft & Minecraft Java

Petal uses [MSMC](https://github.com/Hanro50/MSMC) for Microsoft, Xbox, and
Minecraft authentication. Passwords are entered in Microsoft's sign-in window.
Refresh credentials are encrypted locally; the Minecraft token stays in memory.

Petal requires its own authorized application client ID; it does not borrow
another launcher's ID. Register an application that supports personal Microsoft
accounts in [Microsoft Entra](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app).
Configure the desktop/public client flow and the return URI
`https://login.live.com/oauth20_desktop.srf` according to MSMC's requirements;
see [Microsoft's redirect URI documentation](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-redirect-uri).
Save the application client ID in Petal's settings, then sign in with an account
that owns Minecraft Java Edition.

An OAuth registration alone does not guarantee Xbox or Minecraft service
approval. If the services reject it, obtain the required authorization.
Actual sign-in and an authenticated game session still need end-to-end testing.

## Java & mod loaders

Petal reads Minecraft's official metadata to select and download the required
Java runtime. A custom `java.exe` path may override it, but its major version
must match the game requirement.

Fabric uses official loader metadata. Forge uses the recommended release, or
the latest promoted release. NeoForge selects a matching stable version. The
selected loader version is stored per profile. Game downloads use a bounded
connection pool and three retry attempts; retries reuse verified cache files.

## Build the portable executable

```powershell
pnpm dist
```

The unsigned development build is written to `dist/Petal 0.2.0.exe`. It runs
without Node.js installed. Generated builds are excluded from Git.

## Checks

```powershell
pnpm test
node scripts/integration.cjs
```

The integration script downloads Minecraft 1.21.1, Java 21, all three loaders,
and Iris/Sodium from Modrinth. It checks launch arguments without signing in
or starting a game. Its cache is isolated under `artifacts/integration`.

For UI smoke checks in a separate data directory:

```powershell
$env:PETAL_SMOKE_TEST = '1'
$env:PETAL_DATA_DIR = "$PWD/artifacts/smoke"
pnpm start
Remove-Item Env:PETAL_SMOKE_TEST
Remove-Item Env:PETAL_DATA_DIR
```

The app checks profile creation, a real Modrinth installation, persistent
settings, and IPC rejection, saves reports and screenshots, then closes.
See [VERIFICATION.md](../VERIFICATION.md) for the validated versions and limits.

## Local data

Normal data is stored in `%APPDATA%/petal-launcher/data`; the exact path appears
in settings. `state.json` stores profiles. `credentials.json` stores encrypted
credentials tied to the Windows account. Reconfigure credentials after moving
to another computer. Never publish these files or game caches.

## Known limits

- The catalogs retain distinct identifiers; avoid installing the same mod from
  both sources. Equal names are not a reliable cross-platform identity.
- Conflict checks use declared metadata and file collisions, not runtime analysis.
- Handled download or persistence failures restore the previous installation;
  automatic recovery after a sudden process crash during copying is pending.
- Updates are per mod; pinned dependencies prevent incompatible updates.
- This alpha manages `.jar` mods. Modpack import/export, shaders, resource packs,
  and multiple accounts are not implemented.
- Keep the pinned `@xmcl` versions unless installation and launch preparation
  are revalidated after a dependency upgrade.
