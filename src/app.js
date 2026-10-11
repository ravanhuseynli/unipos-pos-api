const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const { testConnection } = require('./config/database');
const routes = require('./routes');
const { initSocket } = require('./socket');
const { ensureQrSchema } = require('./config/qrSchema');

const app = express();

// Security middleware
app.use(helmet());

// CORS configuration - allow all origins
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    credentials: false
}));

// Handle preflight requests
app.options('*', cors());

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 3000, // Limit each IP to 100 requests per windowMs
    message: {
        success: false,
        message: 'Çox çox sorğu göndərdiniz. Zəhmət olmasa bir az gözləyin.'
    }
});
app.use('/api', limiter);

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API routes
app.use('/api', routes);

// Root route
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'UniPOS Admin Panel API',
        version: '1.0.0',
        documentation: '/api/health'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Endpoint tapılmadı.'
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Xəta:', err);
    res.status(500).json({
        success: false,
        message: 'Daxili server xətası.'
    });
});

// Start server
const PORT = process.env.PORT || 3000;

const startServer = async () => {
    // Test database connection first
    await testConnection();

    // QR sifarişinin cədvəli və sütunları — yoxdursa özü yaradılır
    await ensureQrSchema();

    // Socket (QR sifarişi) eyni port üzərində işləyir: /socket.io
    const server = http.createServer(app);
    initSocket(server);

    server.listen(PORT, () => {
        console.log(`🚀 Server ${PORT} portunda işləyir`);
        console.log(`📍 API: http://localhost:${PORT}/api`);
        console.log(`🔐 Login: POST http://localhost:${PORT}/api/auth/login`);
    });
};

startServer();
