#!/usr/bin/env node
import fetch from 'node-fetch';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, unlinkSync } from 'fs';

const execAsync = promisify(exec);
const API_BASE = 'https://hs-code-verifier-api-auth.workers.dev';

async function hashPassword(password, salt) {
    // Używamy tego samego algorytmu co w workerze
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(salt),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(password));
    return btoa(String.fromCharCode(...new Uint8Array(signature)))
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

async function addUser(username, password, role = 'user') {
    const kvId = 'd4e909bdc6114613ab76635fadb855b2'; // to samo KV
    const salt = process.env.JWT_SECRET; // musisz mieć ustawione JWT_SECRET w środowisku
    if (!salt) {
        console.error('Brak JWT_SECRET w środowisku!');
        process.exit(1);
    }

    const hash = await hashPassword(password, salt + username);
    const userData = JSON.stringify({
        passwordHash: hash,
        role,
        createdAt: new Date().toISOString()
    });

    const tmpFile = `/tmp/user_${username}.json`;
    writeFileSync(tmpFile, userData);

    const cmd = `npx wrangler kv key put --namespace-id=${kvId} "user:${username}" --path ${tmpFile} --remote`;
    try {
        const { stdout, stderr } = await execAsync(cmd);
        console.log(`Użytkownik ${username} dodany.`);
        if (stderr) console.error(stderr);
    } catch (error) {
        console.error('Błąd:', error);
    } finally {
        unlinkSync(tmpFile);
    }
}

// Obsługa argumentów wiersza poleceń
const args = process.argv.slice(2);
if (args.length < 2) {
    console.log('Użycie: node scripts/add-user.js <username> <password> [role]');
    process.exit(1);
}
const [username, password, role = 'user'] = args;
addUser(username, password, role);