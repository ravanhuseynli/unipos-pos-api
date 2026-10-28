const { ensureColumns } = require('./qrSchema');

/**
 * Terminal sxemi — server hər işə düşəndə yoxlanılır, çatışmayan sütun özü
 * əlavə olunur (qrSchema.js ilə eyni qayda).
 *
 *   - `terminal_groups.terminal_type` — terminalın növü; POS onu
 *     `POST /api/terminal/login` cavabında `data.terminal.terminal_type` kimi oxuyur.
 *     NULL — növ təyin olunmayıb.
 *
 * ATMIR: alınmasa xəta yazılır və server yenə açılır — login `SELECT *` ilə
 * oxuyur, sütun olmasa `terminal_type: null` qaytarır.
 */

const TERMINAL_GROUP_COLUMNS = [
    { name: 'terminal_type', definition: 'VARCHAR(32) NULL DEFAULT NULL' },
];

async function ensureTerminalSchema() {
    try {
        await ensureColumns('terminal_groups', TERMINAL_GROUP_COLUMNS);
        console.log('✅ Terminal sxemi hazırdır');
    } catch (error) {
        console.error('❌ Terminal sxemi hazırlanmadı (terminal_type null qayıdacaq):', error.message);
    }
}

module.exports = { ensureTerminalSchema };
