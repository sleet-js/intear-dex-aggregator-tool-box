// ========================================
// VERSION_SYNC
// set the version in package.json.
//
// usage:
//   bun run scripts/version-sync.ts              # patch bump (0.1.1 -> 0.1.2)
//   bun run scripts/version-sync.ts patch        # patch bump
//   bun run scripts/version-sync.ts minor        # minor bump
//   bun run scripts/version-sync.ts major        # major bump
//   bun run scripts/version-sync.ts 1.2.3        # set an exact version
//   bun run scripts/version-sync.ts --dry-run    # preview, write nothing
// ========================================

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PACKAGE_JSON_PATH = join(import.meta.dir, "..", "package.json");

interface version_parts {
  major: number;
  minor: number;
  patch: number;
}

function parse_version(version: string): version_parts {
  const parts = version.split(".").map(Number);
  return {
    major: parts[0] ?? 0,
    minor: parts[1] ?? 0,
    patch: parts[2] ?? 0,
  };
}

function version_to_string(v: version_parts): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

function bump_version(
  version: string,
  type: "patch" | "minor" | "major",
): string {
  const v = parse_version(version);
  switch (type) {
    case "major":
      return version_to_string({ major: v.major + 1, minor: 0, patch: 0 });
    case "minor":
      return version_to_string({
        major: v.major,
        minor: v.minor + 1,
        patch: 0,
      });
    case "patch":
      return version_to_string({
        major: v.major,
        minor: v.minor,
        patch: v.patch + 1,
      });
  }
}

function read_package_json(): Record<string, unknown> {
  return JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf-8"));
}

function package_name_of(package_json: Record<string, unknown>): string {
  return (package_json.name as string) ?? "(unnamed)";
}

async function main() {
  const args = Bun.argv.slice(2);
  const dry_run = args.includes("--dry-run");

  const version_arg = args.find(
    (arg) =>
      !arg.startsWith("--") && !["patch", "minor", "major"].includes(arg),
  );
  const bump_type_arg = args.find((arg) =>
    ["patch", "minor", "major"].includes(arg),
  ) as "patch" | "minor" | "major" | undefined;

  const package_json = read_package_json();
  const current_version = (package_json.version as string) ?? "0.0.0";

  console.log("🔍 Reading package.json...\n");
  console.log(`  ${package_name_of(package_json)}  ${current_version}\n`);

  let target_version: string;

  if (version_arg) {
    target_version = version_arg;
    console.log(`🎯 Setting version to: ${target_version}`);
  } else {
    const bump_type = bump_type_arg ?? "patch";
    target_version = bump_version(current_version, bump_type);
    console.log(
      `🚀 Bumping ${current_version} -> ${target_version} (${bump_type} bump)`,
    );
  }

  if (dry_run) {
    console.log("\n🔎 DRY RUN — no files were modified");
    if (current_version === target_version) {
      console.log(`✅ already at ${target_version}`);
    } else {
      console.log(`📝 would write ${current_version} -> ${target_version}`);
    }
    return;
  }

  package_json.version = target_version;
  writeFileSync(
    PACKAGE_JSON_PATH,
    JSON.stringify(package_json, null, 2) + "\n",
  );

  console.log(`\n✅ package.json is now at ${target_version}`);
}

main().catch((error: unknown) => {
  console.error("❌ Error:", (error as Error).message);
  process.exit(1);
});
// ========================================
// copyright 2026 by sleet.near
