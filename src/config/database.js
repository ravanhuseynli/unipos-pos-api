const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'unipos',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Test database connection
const testConnection = async () => {
    try {
        const connection = await pool.getConnection();
        console.log('✅ Database bağlantısı uğurlu!');
        connection.release();
    } catch (error) {
        console.error('❌ Database bağlantı xətası:', error.message);
        process.exit(1);
    }
};

module.exports = { pool, testConnection };
