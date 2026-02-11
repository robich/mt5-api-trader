import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Apply Claude's proposed changes to the repository files.
 * Uses exact string matching (search & replace) like an edit tool.
 *
 * @param {Array} changes - Array of { file, description, searchBlock, replaceBlock }
 * @param {string} repoDir - Repository root directory
 * @returns {{ applied: Array, failed: Array, modifiedFiles: string[] }}
 */
export function applyChanges(changes, repoDir) {
  const applied = [];
  const failed = [];
  const modifiedFiles = new Set();

  for (const change of changes) {
    const { file, description, searchBlock, replaceBlock } = change;
    const fullPath = join(repoDir, file);

    // Validate file exists
    if (!existsSync(fullPath)) {
      failed.push({ ...change, error: `File not found: ${file}` });
      continue;
    }

    // Validate searchBlock !== replaceBlock
    if (searchBlock === replaceBlock) {
      failed.push({ ...change, error: 'searchBlock and replaceBlock are identical' });
      continue;
    }

    // Read current content
    let content = readFileSync(fullPath, 'utf-8');

    // Find the searchBlock in the file
    const index = content.indexOf(searchBlock);
    if (index === -1) {
      // Try with normalized whitespace (CRLF vs LF)
      const normalizedSearch = searchBlock.replace(/\r\n/g, '\n');
      const normalizedContent = content.replace(/\r\n/g, '\n');
      const normalizedIndex = normalizedContent.indexOf(normalizedSearch);

      if (normalizedIndex === -1) {
        failed.push({ ...change, error: `searchBlock not found in ${file}` });
        continue;
      }

      // Apply on normalized content and preserve original line endings
      const useCRLF = content.includes('\r\n');
      content = normalizedContent;
      const newContent = content.substring(0, normalizedIndex) +
        replaceBlock.replace(/\r\n/g, '\n') +
        content.substring(normalizedIndex + normalizedSearch.length);

      writeFileSync(fullPath, useCRLF ? newContent.replace(/\n/g, '\r\n') : newContent);
      applied.push({ file, description });
      modifiedFiles.add(file);
      continue;
    }

    // Check for multiple matches (ambiguous)
    const secondIndex = content.indexOf(searchBlock, index + 1);
    if (secondIndex !== -1) {
      failed.push({ ...change, error: `searchBlock is ambiguous (found ${countOccurrences(content, searchBlock)} times) in ${file}` });
      continue;
    }

    // Apply the replacement
    const newContent = content.substring(0, index) +
      replaceBlock +
      content.substring(index + searchBlock.length);

    writeFileSync(fullPath, newContent);
    applied.push({ file, description });
    modifiedFiles.add(file);

    console.log(`[apply] ${file}: ${description}`);
  }

  if (failed.length > 0) {
    console.warn(`[apply] ${failed.length} change(s) failed:`);
    for (const f of failed) {
      console.warn(`  - ${f.file}: ${f.error}`);
    }
  }

  return {
    applied,
    failed,
    modifiedFiles: [...modifiedFiles],
  };
}

/**
 * Count occurrences of a substring in a string.
 */
function countOccurrences(str, sub) {
  let count = 0;
  let pos = 0;
  while ((pos = str.indexOf(sub, pos)) !== -1) {
    count++;
    pos += 1;
  }
  return count;
}
