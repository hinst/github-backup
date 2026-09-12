# github-backup

Backs up all of your GitHub repositories: clones them (via GitHub CLI) into a `backup/` folder and packs everything into a timestamped `MyGitHub_YYYY-MM-DD_HH-mm-ss.7z` archive.

- Forks are excluded; archived repos are cloned into `backup/_archived/`
- Name collisions across orgs are resolved as `owner__repo`
- Git LFS objects are not downloaded (pointer files only)

## Requirements

- [GitHub CLI](https://cli.github.com) — logged in (`gh auth login`)
- [7-Zip](https://www.7-zip.org) — `7z` on PATH

## Usage

```bash
npm install
npm run backup
```
