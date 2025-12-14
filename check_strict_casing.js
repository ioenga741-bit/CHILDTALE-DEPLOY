
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = process.cwd();

// Load git files
const gitFiles = new Set(fs.readFileSync('git_files.txt', 'utf-8').split('\n').filter(Boolean).map(f => f.trim()));

console.log(`Loaded ${gitFiles.size} files from git index.`);

function resolveImport(currentFile, importPath) {
    // We only care about relative imports for now, as node_modules are consistent usually.
    // Also aliased imports if any.
    if (!importPath.startsWith('.') && !importPath.startsWith('@/')) return null;

    let absolutePath;
    if (importPath.startsWith('@/')) {
        absolutePath = path.join(rootDir, importPath.substring(2));
    } else {
        absolutePath = path.resolve(path.dirname(currentFile), importPath);
    }

    return absolutePath;
}

function checkFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const regex = /from\s+['"]([^'"]+)['"]/g;
    let match;

    while ((match = regex.exec(content)) !== null) {
        const importPath = match[1];
        const absolutePath = resolveImport(filePath, importPath);

        if (absolutePath) {
            checkPath(filePath, importPath, absolutePath);
        }
    }

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
    // Convert absolute path to Git relative path
    let relativeToRoot = path.relative(rootDir, absolutePath).replace(/\\/g, '/');

    // Extensions to try
    const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];

    let found = false;
    let matchedFile = "";

    for (const ext of extensions) {
        const tryPath = relativeToRoot + ext;
        if (gitFiles.has(tryPath)) {
            found = true;
            matchedFile = tryPath;
            break;
        }
    }

    // Check if simple casing mismatch
    if (!found) {
        // Only check if it actually exists on FS (to verify it's a local file)
        let existsFS = false;
        for (const ext of extensions) {
            if (fs.existsSync(absolutePath + ext)) {
                existsFS = true;
                break;
            }
        }

        if (existsFS) {
            // It exists on FS but not in Git Set (or casing wrong)
            // Find if it exists in Git Set with different casing
            for (const file of gitFiles) {
                for (const ext of extensions) {
                    const tryPath = relativeToRoot + ext;
                    if (file.toLowerCase() === tryPath.toLowerCase()) {
                        console.error(`[CASING ERROR] in ${path.relative(rootDir, sourceFile)}:`);
                        console.error(`  Import: ${importStr}`);
                        console.error(`  Git has: ${file}`);
                        console.error(`  Import resolves to: ${tryPath}`);
                        found = true; // Mark as found so we don't log "Not found"
                    }
                }
            }

            if (!found) {
                // Check if it's a directory index mismatch
                if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isDirectory()) {
                    // Check for index files in Git
                    for (const idx of ['index.ts', 'index.tsx', 'index.js']) {
                        const tryIdx = (relativeToRoot + '/' + idx).replace('//', '/');
                        if (gitFiles.has(tryIdx)) {
                            found = true;
                            break;
                        }
                    }
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

console.log("Starting Strict Casing Check...");
walk(rootDir);
console.log("Done.");
