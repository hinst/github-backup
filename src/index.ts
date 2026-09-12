#!/usr/bin/env node
/**
 * Downloads all of the current user's GitHub repositories (via GitHub CLI)
 * into a `backup/` folder and packs them into `MyGitHub.7z`.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const BACKUP_DIR = path.resolve("backup");
const ARCHIVE_PATH = path.resolve(`MyGitHub_${timestamp()}.7z`);
const ARCHIVED_SUBDIR = "_archived";

// Skip Git LFS smudge during clone: LFS files are kept as small pointer files
// and their objects are never downloaded (keeps .git/lfs empty).
process.env.GIT_LFS_SKIP_SMUDGE = "1";

/** Format a date as `YYYY-MM-DD_HH-mm-ss` (local time). */
function timestamp(date = new Date()): string {
	const p = (n: number) => n.toString().padStart(2, "0");
	return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`;
}

interface RepoInfo {
	fullName: string;
	archived: boolean;
}

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

/** List all repos of the current user. */
async function listRepos(): Promise<RepoInfo[]> {
	const args = ["api", "--paginate", "--jq", ".[] | {fullName: .full_name, archived}", "user/repos"];

	let out: string;
	try {
		out = await run("gh", args);
	} catch (err) {
		console.error("Failed to list repositories with `gh`. Are you logged in (`gh auth login`)?");
		throw err;
	}

	return out
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as RepoInfo);
}

/**
 * Compute a unique folder name for each repo. If two repos share the same
 * name (e.g. forks across owners), disambiguate with the owner:
 * `owner__repo`.
 */
function assignFolderNames(repos: RepoInfo[]): Map<string, string> {
	const fullNames = repos.map((repo) => repo.fullName);

	const counts = new Map<string, number>();
	for (const fullName of fullNames) {
		const name = fullName.split("/")[1] ?? fullName;
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}

	const folders = new Map<string, string>();
	for (const fullName of fullNames) {
		const [owner, name] = fullName.split("/");
		const unique = name && (counts.get(name) ?? 0) > 1 ? `${owner}__${name}` : name;
		folders.set(fullName, unique ?? fullName);
	}
	return folders;
}

/** Clone a repo into the backup dir. */
async function cloneRepo(fullName: string, folder: string, archived: boolean): Promise<void> {
	const dest = path.join(BACKUP_DIR, archived ? path.join(ARCHIVED_SUBDIR, folder) : folder);

	console.log(`- ${fullName}`);
	await run("gh", ["repo", "clone", fullName, dest], { inherit: true });
}

/** Fail fast with a friendly message if a required external tool is missing. */
async function requireTool(cmd: string, installHint: string): Promise<void> {
	try {
		await run(cmd, ["--help"]);
	} catch {
		throw new Error(
			`Required command \'${cmd}\' was not found or failed to run.\n  ${installHint}`,
		);
	}
}

async function main(): Promise<void> {
	console.log("Checking GitHub CLI authentication...");
	await run("gh", ["auth", "status"]);
	await requireTool("7z", "Install 7-Zip (https://www.7-zip.org) and make sure `7z` is on your PATH.");

	console.log("\nListing repositories...");
	const repos = await listRepos();
	if (repos.length === 0) {
		console.log("No repositories found. Nothing to do.");
		return;
	}
	console.log(`Found ${repos.length} repositories.\n`);

	console.log("Starting a fresh backup (removing any existing backup folder)...");
	if (existsSync(BACKUP_DIR)) {
		rmSync(BACKUP_DIR, { recursive: true, force: true });
		console.log(`- Removed ${BACKUP_DIR}`);
	}

	mkdirSync(BACKUP_DIR, { recursive: true });

	const folders = assignFolderNames(repos);

	let failures = 0;
	for (const repo of repos) {
		const folder = folders.get(repo.fullName) ?? repo.fullName;
		try {
			await cloneRepo(repo.fullName, folder, repo.archived);
		} catch (err) {
			failures++;
			console.error(`  ! Failed to clone ${repo.fullName}: ${err instanceof Error ? err.message : err}`);
		}
	}

	if (failures > 0) {
		throw new Error(`${failures} of ${repos.length} repositories failed to clone.`);
	}

	console.log(`\nAll ${repos.length} repositories cloned into ${BACKUP_DIR}`);
	console.log(`Creating archive ${path.basename(ARCHIVE_PATH)}...`);
	await run("7z", ["a", ARCHIVE_PATH, BACKUP_DIR], { inherit: true });
	console.log(`\nDone: ${ARCHIVE_PATH}`);
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exitCode = 1;
});
