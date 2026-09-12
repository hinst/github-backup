#!/usr/bin/env node
/**
 * Downloads all of the current user's GitHub repositories (via GitHub CLI)
 * into a `backup/` folder and packs them into `MyGitHub.7z`.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const BACKUP_DIR = path.resolve("backup");
const ARCHIVE_NAME = "MyGitHub.7z";
const ARCHIVE_PATH = path.resolve(ARCHIVE_NAME);
const ARCHIVED_SUBDIR = "_archived";

// Skip Git LFS smudge during clone: LFS files are kept as small pointer files
// and their objects are never downloaded (keeps .git/lfs empty).
process.env.GIT_LFS_SKIP_SMUDGE = "1";

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

/** List all repos owned by the current user (or the given one). */
async function listRepos(user?: string): Promise<RepoInfo[]> {
	const endpoint = user ? `users/${user}/repos` : "user/repos";
	const args = ["api", "--paginate", "--jq", ".[] | {full_name, archived}", endpoint];

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

	console.log("Starting a fresh backup (removing any existing backup/archive)...");
if (existsSync(BACKUP_DIR)) {
	rmSync(BACKUP_DIR, { recursive: true, force: true });
	console.log(`- Removed ${BACKUP_DIR}`);
}
if (existsSync(ARCHIVE_PATH)) {
	rmSync(ARCHIVE_PATH);
	console.log(`- Removed ${ARCHIVE_PATH}`);
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
