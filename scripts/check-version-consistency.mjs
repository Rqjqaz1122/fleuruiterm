import { readFile } from 'node:fs/promises';

const packageMetadata = await readJson('package.json');
const tauriConfig = await readJson('src-tauri/tauri.conf.json');
const cargoManifest = await readFile('src-tauri/Cargo.toml', 'utf8');
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

console.log(`FleurTerm version ${version} is consistent.`);

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}
