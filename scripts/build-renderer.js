const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

try {
    console.log('Building renderer...');
    execSync('tsc -p tsconfig.renderer.json', { stdio: 'inherit' });

    // Rename to .mjs
    const src = path.join(__dirname, '../out/renderer.js');
    const dest = path.join(__dirname, '../out/renderer.mjs');

    if (fs.existsSync(src)) {
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        fs.renameSync(src, dest);
        console.log('Renderer built to out/renderer.mjs');
    } else {
        console.error('Error: out/renderer.js not found');
        process.exit(1);
    }
} catch (e) {
    console.error(e);
    process.exit(1);
}
