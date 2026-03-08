#!/usr/bin/env node
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, unlinkSync } from 'fs';
import { createHmac } from 'crypto';

const execAsync = promisify(exec);
const KV_ID = 'd4e909bdc6114613ab76635fadb855b2';

function hashPassword(password, salt) {
    const hmac = createHmac('sha256', salt);
    hmac.update(password);
    return hmac.digest('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

async function addUser(username, password, role = 'user') {
    const salt = process.env.JWT_SECRET;
    if (!salt) {
        console.error('❌ Brak JWT_SECRET w środowisku!');
        process.exit(1);
    }

    const hash = hashPassword(password, salt + username);
    const userData = JSON.stringify({
        passwordHash: hash,
        role,
        createdAt: new Date().toISOString()
    });

    const tmpFile = `/tmp/user_${username}.json`;
    writeFileSync(tmpFile, userData);

    const cmd = `npx wrangler kv key put --namespace-id=${KV_ID} "user:${username}" --path ${tmpFile} --remote`;
    try {
        const { stdout, stderr } = await execAsync(cmd, { env: process.env });
        console.log(`✅ Użytkownik ${username} dodany.`);
        if (stderr) console.error('⚠️ Stderr:', stderr);
        if (stdout) console.log('ℹ️', stdout);
    } catch (error) {
        console.error('❌ Błąd:', error);
    } finally {
        unlinkSync(tmpFile);
    }
}

const args = process.argv.slice(2);
if (args.length < 2) {
    console.log('Użycie: node scripts/add-user.js <username> <password> [role]');
    process.exit(1);
}
const [username, password, role = 'user'] = args;
addUser(username, password, role);