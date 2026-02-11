const express = require('express');
const fetch = require('node-fetch');
const { createClient } = require('@vercel/kv');

const app = express();
app.use(express.json());

// Инициализация Vercel KV
let kv;
try {
  kv = createClient({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });
  console.log(' KV connected');
} catch (error) {
  console.error(' KV connection error:', error);
  // Fallback: временное хранилище в памяти
  kv = {
    storage: new Map(),
    hset: async (key, data) => kv.storage.set(key, data),
    hgetall: async (key) => kv.storage.get(key),
    lpush: async (key, value) => {
      if (!kv.storage.has(key)) kv.storage.set(key, []);
      kv.storage.get(key).unshift(value);
    },
    lrange: async (key, start, end) => {
      const arr = kv.storage.get(key) || [];
      return arr.slice(start, end === -1 ? undefined : end + 1);
    }
  };
}

// 1. /enter - POST - добавление бота
app.post('/enter', async (req, res) => {
    try {
        const { token } = req.body;
        
        if (!token) {
            return res.status(400).json({ error: 'Token required' });
        }

        // Проверяем токен через Telegram API
        const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
        const data = await response.json();
        
        if (!data.ok) {
            return res.status(400).json({ 
                error: 'Invalid bot token',
                details: data.description 
            });
        }

        const username = data.result.username;
        const botId = `bot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Сохраняем в базу
        await kv.hset(`bot:${botId}`, {
            token: token,
            username: username,
            addedAt: new Date().toISOString()
        });

        // Добавляем ID в список
        await kv.lpush('all_bots', botId);

        console.log(` Bot added: @${username} (ID: ${botId})`);
        
        res.json({ 
            success: true, 
            message: 'Bot added successfully',
            bot: {
                id: botId,
                username: username
            }
        });
        
    } catch (error) {
        console.error(' /enter error:', error);
        res.status(500).json({ 
            error: 'Server error',
            message: error.message 
        });
    }
});

// 2. /getbot - GET - получение случайного бота
app.get('/getbot', async (req, res) => {
    try {
        // Получаем все ID ботов
        const botIds = await kv.lrange('all_bots', 0, -1);
        
        if (!botIds || botIds.length === 0) {
            return res.status(404).json({ 
                error: 'No bots available',
                message: 'Database is empty. Add bots first via POST /enter' 
            });
        }
        
        // Выбираем случайный ID
        const randomIndex = Math.floor(Math.random() * botIds.length);
        const randomBotId = botIds[randomIndex];
        
        // Получаем данные бота
        const botData = await kv.hgetall(`bot:${randomBotId}`);
        
        if (!botData || !botData.username) {
            // Удаляем битый ID из списка
            await kv.lrem('all_bots', 0, randomBotId);
            // Пробуем еще раз
            return res.redirect('/getbot');
        }
        
        console.log(` Random bot selected: @${botData.username}`);
        
        res.json({
            success: true,
            username: botData.username,
            id: randomBotId,
            addedAt: botData.addedAt
        });
        
    } catch (error) {
        console.error(' /getbot error:', error);
        res.status(500).json({ 
            error: 'Database error',
            message: error.message 
        });
    }
});

// 3. /stats - GET - статистика (опционально)
app.get('/stats', async (req, res) => {
    try {
        const botIds = await kv.lrange('all_bots', 0, -1);
        const count = botIds ? botIds.length : 0;
        
        res.json({
            totalBots: count,
            status: 'operational'
        });
    } catch (error) {
        res.json({
            totalBots: 0,
            status: 'error',
            error: error.message
        });
    }
});

// 4. Корневой маршрут
app.get('/', (req, res) => {
    res.json({
        api: 'Telegram Bots API',
        version: '1.0',
        endpoints: {
            'POST /enter': 'Add a new bot (requires token)',
            'GET /getbot': 'Get random bot username',
            'GET /stats': 'Get statistics'
        },
        note: 'Use Content-Type: application/json for POST requests'
    });
});

// Обработка ошибок 404
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Экспорт для Vercel
module.exports = app;

// Локальный запуск (для тестирования)
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(` API running`);
        console.log(` Endpoints:`);
        console.log(`   POST `);
        console.log(`   GET  /getbot - Get random bot`);
        console.log(`   GET `);
    });
               }
