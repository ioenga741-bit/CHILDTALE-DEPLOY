
import fs from 'fs';
import path from 'path';

const envPath = path.resolve('.env.local');

try {
    if (fs.existsSync(envPath)) {
        let content = fs.readFileSync(envPath, 'utf8');
        console.log("Original content length:", content.length);

        // Remove all newlines and carriage returns
        content = content.replace(/[\r\n]+/g, '');

        // Ensure it starts with VITE_GEMINI_API_KEY=
        // If the user pasted "GEMINI_API_KEY" or other garbage, we might need to handle it.
        // But assuming it's just the key split up:

        // Split by = if present
        if (content.includes('=')) {
            const parts = content.split('=');
            const key = parts[0].trim();
            const value = parts.slice(1).join('=').replace(/\s/g, ''); // Remove ALL whitespace from value
            content = `${key}=${value}`;
        }

        fs.writeFileSync(envPath, content);
        console.log("Fixed .env.local content:", content.substring(0, 25) + "...");
    } else {
        console.log(".env.local not found");
    }
} catch (e) {
    console.error("Error fixing .env.local:", e);
}
