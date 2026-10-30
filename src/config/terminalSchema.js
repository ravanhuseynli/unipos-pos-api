const { ensureColumns, ensureTable } = require('./qrSchema');

/**
 * Terminal sxemi — server hər işə düşəndə yoxlanılır, çatışmayan sütun özü
 * əlavə olunur (qrSchema.js ilə eyni qayda).
 *
 *   - `terminal_groups.terminal_type` — terminalın növü; POS onu
 *     `POST /api/terminal/login` cavabında `data.terminal.terminal_type` kimi oxuyur.
 *     NULL — növ təyin olunmayıb.
 *   - `terminal_sessions` — POS sessiya tokenləri, `sql/terminal_sessions.sql`-dən
 *     (services/terminalSession.service.js).
 *
 * ATMIR: alınmasa xəta yazılır və server yenə açılır — login `SELECT *` ilə
 * oxuyur, sütun olmasa `terminal_type: null` qaytarır; sessiya cədvəli yoxdursa
 * login `session_token: null` qaytarır (compat rejimində POS yenə işləyir).
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

    try {
        await ensureTable('terminal_sessions');
        console.log('✅ Terminal sessiya sxemi hazırdır');
    } catch (error) {
        console.error('❌ terminal_sessions cədvəli yaradılmadı (sessiya tokeni verilməyəcək):', error.message);
    }
}

module.exports = { ensureTerminalSchema };
