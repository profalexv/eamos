#!/bin/bash

# Script para iniciar MindPool em diferentes ambientes
# Uso: ./start.sh [ambiente]
# Ambientes: local, dev (com nodemon), production

AMBIENTE=${1:-local}

echo "🚀 Iniciando MindPool - Ambiente: $AMBIENTE"
echo ""

# Verificar se node_modules existe
if [ ! -d "node_modules" ]; then
    echo "📦 Instalando dependências..."
    npm install
    echo ""
fi

# Criar .env se não existir
if [ ! -f ".env" ]; then
    echo "⚙️  Criando arquivo .env..."
    cp .env.example .env
    echo "✅ Arquivo .env criado. Ajuste as configurações conforme necessário."
    echo ""
fi

case $AMBIENTE in
    local)
        echo "📌 Modo local (localhost:3000)"
        echo "🔗 Frontend: http://localhost:3000"
        echo "🔗 Backend: http://localhost:3000"
        echo ""
        NODE_ENV=local PORT=3000 node server.js
        ;;
    
    dev)
        echo "📌 Modo desenvolvimento com auto-reload"
        echo "💡 Dica: Instale com: npm install -g nodemon"
        echo ""
        if command -v nodemon &> /dev/null; then
            NODE_ENV=local PORT=3000 nodemon server.js
        else
            echo "⚠️  nodemon não encontrado. Use: npm install -g nodemon"
            echo "Iniciando com 'node' em vez disso..."
            NODE_ENV=local PORT=3000 node server.js
        fi
        ;;
    
    production)
        echo "📌 Modo produção (Render)"
        echo "🔗 Frontend: https://mindpool.alexandre.pro.br"
        echo "🔗 Backend: https://mindpool-backend.onrender.com"
        echo ""
        NODE_ENV=production node server.js
        ;;
    
    *)
        echo "❌ Ambiente desconhecido: $AMBIENTE"
        echo ""
        echo "Ambientes disponíveis:"
        echo "  ./start.sh local        - Desenvolvimento local (localhost:3000)"
        echo "  ./start.sh dev          - Desenvolvimento com auto-reload (nodemon)"
        echo "  ./start.sh production   - Produção (Render/GitHub)"
        echo ""
        exit 1
        ;;
esac
