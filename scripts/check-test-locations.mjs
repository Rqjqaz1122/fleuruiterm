import { readdirSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const TEST_ROOT = resolve(PROJECT_ROOT, 'tests');
const IGNORED_DIRECTORIES = new Set(['.git', 'coverage', 'dist', 'node_modules', 'target']);
const FRONTEND_TEST_FILE_PATTERN = /\.(?:spec|test)\.[cm]?[jt]sx?$/i;

const misplacedTestFiles = collectFrontendTestFiles(PROJECT_ROOT).filter(
  (filePath) => !isInsideDirectory(filePath, TEST_ROOT),
);

if (misplacedTestFiles.length > 0) {
  console.error('JavaScript and TypeScript test files must be placed under tests/:');
  for (const filePath of misplacedTestFiles) {
    console.error(`- ${relative(PROJECT_ROOT, filePath)}`);
  }
  process.exitCode = 1;
}

function collectFrontendTestFiles(directoryPath) {
  const testFiles = [];
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const entryPath = resolve(directoryPath, entry.name);
    if (entry.isDirectory()) {
      testFiles.push(...collectFrontendTestFiles(entryPath));
      continue;
    }
    if (entry.isFile() && FRONTEND_TEST_FILE_PATTERN.test(entry.name)) {
      testFiles.push(entryPath);
    }
  }
  return testFiles;
}

function isInsideDirectory(filePath, directoryPath) {
  const relativePath = relative(directoryPath, filePath);
  return relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
}
