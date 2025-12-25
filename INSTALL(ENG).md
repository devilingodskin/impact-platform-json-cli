# Install

Quick ways to install the CLI so users can run `impact` globally.

1) Install directly from GitHub (recommended, single command):

```bash
npm install -g git+https://github.com/<your-user>/<your-repo>.git
# then run
impact --help
```

2) Install from a local clone (for testing):

```bash
git clone https://github.com/<your-user>/<your-repo>.git
cd <your-repo>
npm install -g .
impact --help
```

3) (Alternative) Use the provided `install.sh` to create a symlink in `/usr/local/bin`:

```bash
# from repo root
bash install.sh
# then run
impact --help
```

Notes
- Requires Node.js (recommended LTS). Check with `node --version`.
- If installing via `npm`, `npm` comes with Node.js.
- If `impact` is not found after install, ensure your global npm bin is in `PATH` (e.g. `npm bin -g`).

Usage examples

```bash
impact old.json new.json --output=report.json
impact config-a.yaml config-b.yaml --format=json
```

Troubleshooting
- If permission errors occur when creating symlink, re-run `install.sh` with `sudo`.
- For Windows users, prefer `npm install -g` or use WSL for symlink option.
