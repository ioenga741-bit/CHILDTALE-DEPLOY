
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv'; // This project has dotenv in package.json? Yes, line 14.

const envPath = path.resolve(process.cwd(), '.env.local');

console.log('Checking .env.local at:', envPath);

if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    console.log('--- RAW CONTENT START ---');
    console.log(content);
    console.log('--- RAW CONTENT END ---');

    const parsed = dotenv.parse(content);
    console.log('Parsed Keys:', Object.keys(parsed));
    for (const key in parsed) {
        const val = parsed[key];
        console.log(`Key: ${key}`);
        console.log(`Length: ${val.length}`);
        console.log(`Value: "${val}"`); // Quoted to see whitespace
        console.log(`Has Carriage Return? ${val.includes('\r')}`);
        console.log(`Has Newline? ${val.includes('\n')}`);
    }
} else {
    console.log('.env.local DOES NOT EXIST');
}
