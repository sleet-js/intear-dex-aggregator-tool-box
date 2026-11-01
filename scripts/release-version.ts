// ========================================
// RELEASE_VERSION
// compute the next release version.
//
// the version comes from TWO places and the higher one wins:
//
//   1. the local package.json
//   2. the versions already on the npm registry
//
// the registry matters: if a version was published but never
// committed, or the commit was lost, the local package.json would be
// behind and we would try to publish a version that already exists.
//
// usage:
//   bun run scripts/release-version.ts patch    # 0.1.1 -> 0.1.2
//   bun run scripts/release-version.ts minor    # 0.1.1 -> 0.2.0
//   bun run scripts/release-version.ts major    # 0.1.1 -> 1.0.0
//
// prints the bare version (no "v") on stdout, so the workflow can
// capture it directly.
// ========================================

import { readFileSync } from "node:fs";
import { join } from "node:path";

const PACKAGE_NAME = "@sleet-js/intear-dex-aggregator-tool-box";

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

function compare_versions(a: string, b: string): number {
  const pa = parse_version(a);
  const pb = parse_version(b);
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  return pa.patch - pb.patch;
}

function find_highest_version(versions: string[]): string {
  return versions.reduce(
    (highest, version) =>
      compare_versions(version, highest) > 0 ? version : highest,
    "0.0.0",
  );
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

function get_local_version(): string {
  const package_json = JSON.parse(
    readFileSync(join(import.meta.dir, "..", "package.json"), "utf-8"),
  );
  return package_json.version ?? "0.0.0";
}

// the versions this package has ever published.
//
// returns [] when the package is not published yet or the registry is
// unreachable — a network failure must not block a release, the
// local version is still a valid floor.
async function fetch_published_versions(
  package_name: string,
): Promise<string[]> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(package_name)}`;
  try {
    const response = await fetch(url);
    if (!response.ok) return [];
    const data = (await response.json()) as {
      versions?: Record<string, unknown>;
    };
    return Object.keys(data.versions ?? {});
  } catch (error) {
    console.warn(
      `⚠️  Could not reach the registry for ${package_name}: ${(error as Error).message}`,
    );
    return [];
  }
}

async function main() {
  const bump_type = (Bun.argv[2] ?? "patch") as "patch" | "minor" | "major";
  if (!["patch", "minor", "major"].includes(bump_type)) {
    console.error(`❌ Unknown bump type: ${bump_type}`);
    process.exit(1);
  }

  const local_version = get_local_version();
  const published = await fetch_published_versions(PACKAGE_NAME);

  const highest_local = find_highest_version([local_version]);
  const highest_published = find_highest_version(published);
  const highest = find_highest_version([highest_local, highest_published]);

  const target = bump_version(highest, bump_type);

  console.error(`Local version:     ${local_version}`);
  if (published.length > 0) {
    console.error(`Published on npm:  ${published.join(", ")}`);
  }
  console.error(`Highest:           ${highest}`);
  console.error(`Bump (${bump_type}):  ${highest} -> ${target}`);

  // Stdout is the version — the workflow captures this.
  console.log(target);
}

main().catch((error: unknown) => {
  console.error("❌ Error:", (error as Error).message);
  process.exit(1);
});
// ========================================
// copyright 2026 by sleet.near
