#!/usr/bin/env node
/**
 * Downloads all of the current user's GitHub repositories (via GitHub CLI)
 * into a `backup/` folder and packs them into `MyGitHub.7z`.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const BACKUP_DIR = path.resolve("backup");
const ARCHIVE_NAME = "MyGitHub.7z";

/** Run a command and resolve with its stdout (trimmed). */
function run(
  cmd: string,
  args: string[],
  opts: { silent?: boolean; inherit?: boolean } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      {
        maxBuffer: 64 * 1024 * 1024,
        ...(opts.inherit ? { stdio: ["ignore", "inherit", "inherit"] } : {}),
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `${cmd} ${args.join(" ")} failed: ${error.message}${stderr ? `\n${stderr}` : ""}`,
            ),
          );
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

/** List all repos owned by the current user (or the given one). */
async function listRepos(user?: string): Promise<string[]> {
  const endpoint = user ? `users/${user}/repos` : "user/repos";
  const args = ["api", "--paginate", "--jq", ".[].full_name", endpoint];

  let out: string;
  try {
    out = await run("gh", args);
  } catch (err) {
    console.error("Failed to list repositories with `gh`. Are you logged in (`gh auth login`)?");
    throw err;
  }

  return out.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
}

/** Clone a repo into the backup dir if it isn't already there. */
async function cloneRepo(fullName: string): Promise<void> {
  const name = fullName.split("/")[1] ?? fullName;
  const dest = path.join(BACKUP_DIR, name);

  if (existsSync(dest)) {
    console.log(`- ${fullName} (already present, skipping)`);
    return;
  }

  console.log(`- ${fullName}`);
  await run("gh", ["repo", "clone", fullName, dest], { inherit: true });
}

async function main(): Promise<void> {
  console.log("Checking GitHub CLI authentication...");
  await run("gh", ["auth", "status"]);

  console.log("\nListing repositories...");
  const repos = await listRepos(process.argv[2]);
  if (repos.length === 0) {
    console.log("No repositories found. Nothing to do.");
    return;
  }
  console.log(`Found ${repos.length} repositories.\n`);

  mkdirSync(BACKUP_DIR, { recursive: true });

  let failures = 0;
  for (const repo of repos) {
    try {
      await cloneRepo(repo);
    } catch (err) {
      failures++;
      console.error(`  ! Failed to clone ${repo}: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (failures > 0) {
    throw new Error(`${failures} of ${repos.length} repositories failed to clone.`);
  }

  console.log(`\nAll ${repos.length} repositories cloned into ${BACKUP_DIR}`);
  console.log(`Creating archive ${ARCHIVE_NAME}...`);
  await run("7z", ["a", ARCHIVE_NAME, BACKUP_DIR], { inherit: true });
  console.log(`\nDone: ${path.resolve(ARCHIVE_NAME)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
