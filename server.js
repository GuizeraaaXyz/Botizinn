const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());

// Caminho absoluto para o arquivo
const BOTS_FILE = path.join(__dirname, 'bots.json');

// Função para carregar bots com debug
function loadBots() {
    try {
        console.log('📂 Tentando carregar bots de:', BOTS_FILE);
        
        if (fs.existsSync(BOTS_FILE)) {
            const data = fs.readFileSync(BOTS_FILE, 'utf8');
            console.log('📄 Conteúdo do arquivo:', data);
            
            const savedBots = JSON.parse(data);
            const botsMap = new Map();
            
            for (const [id, botData] of Object.entries(savedBots)) {
                botsMap.set(id, {
                    ...botData,
                    bot: null,
                    connecting: false,
                    sequenceRunning: false,
                    reconnectTimeout: null
                });
            }
            
            console.log(`✅ Carregados ${botsMap.size} bots do arquivo`);
            return botsMap;
        } else {
            console.log('⚠️ Arquivo bots.json não existe, criando novo...');
            return new Map();
        }
    } catch (error) {
        console.error('❌ Erro ao carregar bots:', error);
        return new Map();
    }
}

// Função para salvar bots com debug
function saveBots() {
    try {
        const botsToSave = {};
        for (const [id, botData] of bots) {
            botsToSave[id] = {
                config: botData.config,
                status: botData.status
            };
        }
        
        const dataToSave = JSON.stringify(botsToSave, null, 2);
        fs.writeFileSync(BOTS_FILE, dataToSave, 'utf8');
        console.log(`💾 Salvos ${bots.size} bots no arquivo`);
        console.log('📁 Arquivo salvo em:', BOTS_FILE);
        
    } catch (error) {
        console.error('❌ Erro ao salvar bots:', error);
    }
}

// Inicializar armazenamento
let bots = loadBots();

// Se não tem nenhum bot, criar um de exemplo
if (bots.size === 0) {
    console.log('📝 Criando bot de exemplo...');
    const defaultBotId = 'bot_' + Date.now();
    bots.set(defaultBotId, {
        bot: null,
        config: {
            nome: 'cachorrodomato_2',
            server: 'healtzcraft.com',
            port: 25565,
            version: '1.21.4',
            auth: 'offline',
            senha: '250719802023',
            running: false,
            autoSequence: true,
            commands: [
                { command: '/login {senha}', enabled: true, minDelay: 6, maxDelay: 12, afterDelay: 5, afterDelayMax: 10 },
                { command: '/skyblock', enabled: true, minDelay: 8, maxDelay: 15, afterDelay: 15, afterDelayMax: 25 },
                { command: '/home farm', enabled: true, minDelay: 5, maxDelay: 10, afterDelay: 8, afterDelayMax: 15 },
                { command: '/ac', enabled: true, minDelay: 4, maxDelay: 8, afterDelay: 0, afterDelayMax: 0 }
            ]
        },
        status: 'offline',
        connecting: false,
        sequenceRunning: false,
        reconnectTimeout: null
    });
    saveBots();
}

function humanDelay(minSec, maxSec) {
    return Math.floor(Math.random() * (maxSec - minSec + 1) + minSec) * 1000;
}

function destroyBot(botId) {
    const botData = bots.get(botId);
    if (!botData) return;

    if (botData.reconnectTimeout) {
        clearTimeout(botData.reconnectTimeout);
        botData.reconnectTimeout = null;
    }
    
    if (botData.bot) {
        try {
            botData.bot.quit();
        } catch(e) {}
    }
    
    botData.bot = null;
    botData.connecting = false;
    botData.sequenceRunning = false;
    botData.status = 'offline';
    
    bots.set(botId, botData);
    saveBots();
    io.emit('botStatus', { id: botId, status: 'offline', name: botData.config.nome });
}

async function sendCommand(botData, cmd, minDelay, maxDelay, logMsg) {
    let finalCmd = cmd.replace('{senha}', botData.config.senha || '');
    
    return new Promise((resolve) => {
        const delay = humanDelay(minDelay, maxDelay);
        setTimeout(() => {
            if (botData.bot && botData.bot.entity) {
                botData.bot.chat(finalCmd);
                console.log(`[${botData.config.nome}] ${logMsg} -> ${finalCmd}`);
                resolve();
            } else {
                console.log(`[${botData.config.nome}] ❌ Desconectado`);
                resolve();
            }
        }, delay);
    });
}

async function runAutoSequence(botId) {
    const botData = bots.get(botId);
    if (!botData || !botData.config.autoSequence) return;
    if (!botData.bot || !botData.bot.entity) {
        botData.sequenceRunning = false;
        bots.set(botId, botData);
        return;
    }

    console.log(`[${botData.config.nome}] 🚜 INICIANDO SEQUÊNCIA...`);
    botData.sequenceRunning = true;
    bots.set(botId, botData);
    io.emit('botSequence', { id: botId, running: true });

    try {
        await new Promise(r => setTimeout(r, humanDelay(5, 10)));
        
        const commands = botData.config.commands || [];
        for (const cmd of commands) {
            if (cmd.enabled) {
                await sendCommand(botData, cmd.command, cmd.minDelay || 4, cmd.maxDelay || 10, `✅ Executando`);
                if (cmd.afterDelay > 0) {
                    await new Promise(r => setTimeout(r, humanDelay(cmd.afterDelay, cmd.afterDelayMax || cmd.afterDelay + 5)));
                }
            }
        }

        console.log(`[${botData.config.nome}] 🎉 SEQUÊNCIA COMPLETA!`);
    } catch (e) {
        console.log(`[${botData.config.nome}] ❌ Erro: ${e.message}`);
    }

    botData.sequenceRunning = false;
    bots.set(botId, botData);
    io.emit('botSequence', { id: botId, running: false });
}

function createBot(botId) {
    const botData = bots.get(botId);
    if (!botData || botData.connecting) return;
    
    destroyBot(botId);
    
    botData.connecting = true;
    botData.status = 'connecting';
    bots.set(botId, botData);
    saveBots();
    io.emit('botStatus', { id: botId, status: 'connecting', name: botData.config.nome });

    console.log(`[${botData.config.nome}] 🔌 Conectando a ${botData.config.server}:${botData.config.port}`);

    const options = {
        host: botData.config.server,
        port: botData.config.port || 25565,
        username: botData.config.nome,
        version: botData.config.version || '1.21.4',
        auth: botData.config.auth || 'offline',
        skipValidation: true,
        viewDistance: 'far'
    };

    const bot = mineflayer.createBot(options);
    botData.bot = bot;

    bot.on('resourcePack', (pack) => {
        console.log(`[${botData.config.nome}] 📦 Resource pack detectado`);
        try {
            bot.acceptResourcePack();
        } catch(e) {}
    });

    bot.once('spawn', () => {
        console.log(`[${botData.config.nome}] ✅ Conectado!`);
        botData.connecting = false;
        botData.status = 'online';
        bots.set(botId, botData);
        saveBots();
        io.emit('botStatus', { id: botId, status: 'online', name: botData.config.nome });
        
        setTimeout(() => {
            if (botData.config.autoSequence && !botData.sequenceRunning) {
                setTimeout(() => runAutoSequence(botId), humanDelay(8, 15));
            }
        }, 3000);
    });

    bot.on('kicked', (reason) => {
        let msg = '';
        try {
            if (typeof reason === 'string') msg = reason;
            else if (reason?.text) msg = reason.text;
            else msg = JSON.stringify(reason);
        } catch(e) {
            msg = 'Desconhecido';
        }
        console.log(`[${botData.config.nome}] 🚫 Kickado: ${msg.substring(0, 100)}`);
        botData.status = 'kicked';
        bots.set(botId, botData);
        saveBots();
        io.emit('botStatus', { id: botId, status: 'kicked', name: botData.config.nome });
        
        if (botData.config.running && !botData.reconnectTimeout) {
            const delay = humanDelay(90, 120);
            botData.reconnectTimeout = setTimeout(() => {
                botData.reconnectTimeout = null;
                createBot(botId);
            }, delay);
        }
    });

    bot.on('end', () => {
        console.log(`[${botData.config.nome}] ❌ Desconectado`);
        botData.status = 'offline';
        bots.set(botId, botData);
        saveBots();
        io.emit('botStatus', { id: botId, status: 'offline', name: botData.config.nome });
        
        if (botData.config.running && !botData.reconnectTimeout) {
            const delay = humanDelay(45, 75);
            botData.reconnectTimeout = setTimeout(() => {
                botData.reconnectTimeout = null;
                createBot(botId);
            }, delay);
        }
    });

    bot.on('error', (err) => {
        console.log(`[${botData.config.nome}] ⚠️ Erro: ${err.message}`);
    });
}

// API Endpoints
app.get('/api/bots', (req, res) => {
    const botList = Array.from(bots.entries()).map(([id, data]) => ({
        id,
        nome: data.config.nome,
        server: data.config.server,
        status: data.status,
        running: data.config.running,
        autoSequence: data.config.autoSequence
    }));
    console.log(`📡 Enviando lista com ${botList.length} bots`);
    res.json(botList);
});

app.get('/api/bot/:id', (req, res) => {
    const botData = bots.get(req.params.id);
    if (!botData) return res.status(404).json({ error: 'Bot não encontrado' });
    res.json(botData.config);
});

app.post('/api/bot/create', (req, res) => {
    console.log('📝 Recebido pedido para criar bot:', req.body);
    
    const { nome, server, port, senha, version, auth } = req.body;
    
    // Validar dados
    if (!nome || !server || !senha) {
        return res.status(400).json({ error: 'Nome, servidor e senha são obrigatórios' });
    }
    
    const botId = Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9);
    
    const botConfig = {
        nome: nome,
        server: server,
        port: port || 25565,
        version: version || '1.21.4',
        auth: auth || 'offline',
        senha: senha,
        running: false,
        autoSequence: true,
        commands: [
            { command: '/login {senha}', enabled: true, minDelay: 6, maxDelay: 12, afterDelay: 5, afterDelayMax: 10 },
            { command: '/skyblock', enabled: true, minDelay: 8, maxDelay: 15, afterDelay: 15, afterDelayMax: 25 },
            { command: '/home farm', enabled: true, minDelay: 5, maxDelay: 10, afterDelay: 8, afterDelayMax: 15 },
            { command: '/ac', enabled: true, minDelay: 4, maxDelay: 8, afterDelay: 0, afterDelayMax: 0 }
        ]
    };
    
    bots.set(botId, {
        bot: null,
        config: botConfig,
        status: 'offline',
        connecting: false,
        sequenceRunning: false,
        reconnectTimeout: null
    });
    
    saveBots(); // Salvar imediatamente
    
    console.log(`✅ Bot criado com ID: ${botId}`);
    console.log(`📊 Total de bots: ${bots.size}`);
    
    res.json({ success: true, id: botId });
});

app.post('/api/bot/:id/start', (req, res) => {
    const botData = bots.get(req.params.id);
    if (!botData) return res.status(404).json({ error: 'Bot não encontrado' });
    
    botData.config.running = true;
    bots.set(req.params.id, botData);
    saveBots();
    createBot(req.params.id);
    res.json({ success: true });
});

app.post('/api/bot/:id/stop', (req, res) => {
    const botData = bots.get(req.params.id);
    if (!botData) return res.status(404).json({ error: 'Bot não encontrado' });
    
    botData.config.running = false;
    botData.config.autoSequence = false;
    bots.set(req.params.id, botData);
    saveBots();
    destroyBot(req.params.id);
    res.json({ success: true });
});

app.post('/api/bot/:id/update', (req, res) => {
    const botData = bots.get(req.params.id);
    if (!botData) return res.status(404).json({ error: 'Bot não encontrado' });
    
    botData.config = { ...botData.config, ...req.body };
    bots.set(req.params.id, botData);
    saveBots();
    res.json({ success: true });
});

app.post('/api/bot/:id/command', (req, res) => {
    const botData = bots.get(req.params.id);
    if (!botData || !botData.bot || !botData.bot.entity) {
        return res.status(400).json({ error: 'Bot não conectado' });
    }
    
    let command = req.body.command;
    command = command.replace('{senha}', botData.config.senha || '');
    
    botData.bot.chat(command);
    console.log(`[${botData.config.nome}] 💬 Comando: ${command}`);
    res.json({ success: true });
});

app.post('/api/bot/:id/toggleAuto', (req, res) => {
    const botData = bots.get(req.params.id);
    if (!botData) return res.status(404).json({ error: 'Bot não encontrado' });
    
    botData.config.autoSequence = !botData.config.autoSequence;
    bots.set(req.params.id, botData);
    saveBots();
    
    if (botData.config.autoSequence && botData.bot?.entity && !botData.sequenceRunning) {
        setTimeout(() => runAutoSequence(req.params.id), humanDelay(8, 15));
    }
    
    res.json({ success: true, autoSequence: botData.config.autoSequence });
});

app.post('/api/bot/:id/commandSequence', (req, res) => {
    const botData = bots.get(req.params.id);
    if (!botData) return res.status(404).json({ error: 'Bot não encontrado' });
    
    botData.config.commands = req.body.commands;
    bots.set(req.params.id, botData);
    saveBots();
    res.json({ success: true });
});

app.delete('/api/bot/:id', (req, res) => {
    const botData = bots.get(req.params.id);
    if (!botData) return res.status(404).json({ error: 'Bot não encontrado' });
    
    destroyBot(req.params.id);
    bots.delete(req.params.id);
    saveBots();
    res.json({ success: true });
});

// Socket.io
io.on('connection', (socket) => {
    console.log('📡 Dashboard conectado');
    
    const botList = Array.from(bots.entries()).map(([id, data]) => ({
        id,
        nome: data.config.nome,
        server: data.config.server,
        status: data.status
    }));
    socket.emit('botList', botList);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n🌐 Servidor rodando na porta ${PORT}`);
    console.log(`📱 Dashboard: http://localhost:${PORT}`);
    console.log(`📁 Arquivo de bots: ${BOTS_FILE}`);
    console.log(`🤖 Bots carregados: ${bots.size}\n`);
});