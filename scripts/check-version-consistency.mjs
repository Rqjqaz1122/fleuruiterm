import { readFile } from 'node:fs/promises';

const FORBIDDEN_GENERIC_RELEASE_BODY = 'See the assets below to install or update FleurTerm.';

const packageMetadata = await readJson('package.json');
const tauriConfig = await readJson('src-tauri/tauri.conf.json');
const cargoManifest = await readFile('src-tauri/Cargo.toml', 'utf8');
const releaseWorkflow = await readFile('.github/workflows/release.yml', 'utf8');
const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargoManifest)?.[1];
const versions = new Map([
  ['package.json', packageMetadata.version],
  ['src-tauri/tauri.conf.json', tauriConfig.version],
  ['src-tauri/Cargo.toml', cargoVersion],
]);

for (const [source, version] of versions) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    console.error(`Invalid semantic version in ${source}`);
    process.exit(1);
  }
}

const uniqueVersions = new Set(versions.values());
if (uniqueVersions.size !== 1) {
  console.error(
    `Version mismatch: ${[...versions].map(([source, version]) => `${source}=${version}`).join(', ')}`,
  );
  process.exit(1);
}

const version = versions.values().next().value;
const tag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined;
if (tag !== undefined && tag !== `v${version}`) {
  console.error(`Release tag ${tag} does not match application version v${version}`);
  process.exit(1);
}

const updaterEndpoints = tauriConfig.plugins?.updater?.endpoints ?? [];
const usesLatestGitHubRelease = updaterEndpoints.some((endpoint) =>
  endpoint.includes('/releases/latest/'),
);
const createsPrerelease = /^\s*prerelease:\s*true\s*$/m.test(releaseWorkflow);
if (usesLatestGitHubRelease && createsPrerelease) {
  console.error(
    'Updater channel mismatch: GitHub prereleases are not available through /releases/latest/.',
  );
  process.exit(1);
}

if (releaseWorkflow.includes(`releaseBody: ${FORBIDDEN_GENERIC_RELEASE_BODY}`)) {
  console.error('Release workflow must not use the generic FleurTerm release body.');
  process.exit(1);
}

if (
  !/^\s*releaseBody:\s*\$\{\{\s*steps\.release_notes\.outputs\.body\s*\}\}\s*$/m.test(
    releaseWorkflow,
  )
) {
  console.error('Release workflow must publish notes from the annotated tag body.');
  process.exit(1);
}

console.log(`FleurTerm version ${version} is consistent.`);

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}
