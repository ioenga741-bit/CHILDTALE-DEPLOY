
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = process.cwd();

function getActualFilename(dir, filename) {
  try {
    const files = fs.readdirSync(dir);
    return files.find(f => f.toLowerCase() === filename.toLowerCase());
  } catch (e) {
    return null;
  }
}

function resolveImport(currentFile, importPath) {
  if (importPath.startsWith('.')) {
    return path.resolve(path.dirname(currentFile), importPath);
  }
  if (importPath.startsWith('@/')) {
    return path.join(rootDir, importPath.substring(2));
  }
  return null; // Node module or absolute (ignored)
}

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  // Match import ... from '...' and export ... from '...'
  const regex = /from\s+['"]([^'"]+)['"]/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const importPath = match[1];
    const absolutePath = resolveImport(filePath, importPath);

    if (absolutePath) {
      checkPath(filePath, importPath, absolutePath);
    }
  }
  
  // Also check dynamic imports import('...')
  const dynamicRegex = /import\(['"]([^'"]+)['"]\)/g;
  while ((match = dynamicRegex.exec(content)) !== null) {
     const importPath = match[1];
     const absolutePath = resolveImport(filePath, importPath);
     if (absolutePath) {
        checkPath(filePath, importPath, absolutePath);
     }
  }
}

function checkPath(sourceFile, importStr, absolutePath) {
  const dir = path.dirname(absolutePath);
  const basename = path.basename(absolutePath);
  
  // Extensions to try
  const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];
  
  let found = false;
  let actualName = null;

  for (const ext of extensions) {
    const tryName = basename + ext;
    // Check if parts match
    // We need to walk the path from root to verify each segment? 
    // Just verify the final filename existence in the directory first.
    
    // For simplicity, let's assume the directory path is correct up to the last part,
    // and we only check the file existence and casing.
    // Actually, we should check availability.
    
    if (fs.existsSync(absolutePath + ext)) {
        // Now check Strict Casing of the filename
        const actual = getActualFilename(dir, basename + ext);
        if (actual && actual === basename + ext) {
            found = true;
            break;
        } else if (actual) {
            console.error(`[CASING ERROR] in ${path.relative(rootDir, sourceFile)}:`);
            console.error(`  Import: ${importStr}`);
            console.error(`  Expected: ${basename + ext}`);
            console.error(`  Actual:   ${actual}`);
            found = true; // Found but casing wrong
        }
    }
  }
  
  // Special handling for directory imports (implicit index)
  if (!found) {
     // Check if it is a directory
     if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isDirectory()) {
         // Check index files
         const indexExtensions = ['index.ts', 'index.tsx', 'index.js'];
         for (const idx of indexExtensions) {
             const idxPath = path.join(absolutePath, idx);
             if (fs.existsSync(idxPath)) {
                 found = true;
                 break;
             }
         }
     }
  }

  if (!found) {
     // Check if it exists with different casing
     // This is the most consistent check for Windows user
     // We construct the full path with extensions and check if it exists on disk (Windows is case insensitive so it will say yes)
     // Then we check readdir to see real name.
     
     let existsOnDisk = false;
     let realName = "";
     
     for (const ext of extensions) {
        const full = absolutePath + ext;
        if (fs.existsSync(full)) {
             existsOnDisk = true;
             // Find real name
             const b = path.basename(full);
             const d = path.dirname(full);
             const real = getActualFilename(d, b);
             if (real && real !== b) {
                 console.error(`[CASING ERROR] in ${path.relative(rootDir, sourceFile)}:`);
                 console.error(`  Import: ${importStr}`);
                 console.error(`  FS found: ${real}`);
             }
        }
     }
  }
}

function walk(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (file === 'node_modules' || file === '.git' || file === 'dist') continue;
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath);
    } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      checkFile(fullPath);
    }
  }
}

console.log("Starting Casing Check...");
walk(rootDir);
console.log("Done.");
